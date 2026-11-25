// Juiz: compila e executa código C em container Docker isolado, compara saídas.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const IMAGE = process.env.JUDGE_IMAGE || 'gcc:13';
const CONCURRENCY = Number(process.env.JUDGE_CONCURRENCY || 2);
const TIME_LIMIT = Number(process.env.JUDGE_TIME_LIMIT || 2); // segundos por caso
// Em container, JOBS_DIR precisa existir com o MESMO caminho no host (o docker do host monta a pasta).
const JOBS_DIR = process.env.JOBS_DIR || path.join(os.tmpdir(), 'provafap-jobs');
const SANDBOX_DIR = path.join(__dirname, 'sandbox');

fs.mkdirSync(JOBS_DIR, { recursive: true });

// ---------- fila ----------
let running = 0;
const queue = [];

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const { fn, resolve, reject } = queue.shift();
    running++;
    fn()
      .then(resolve, reject)
      .finally(() => {
        running--;
        pump();
      });
  }
}

const queueSize = () => queue.length + running;

// ---------- execução ----------
function docker(args, timeoutMs) {
  return new Promise((resolve) => {
    const p = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      resolve({ code: -1, stderr: 'timeout', killed: true });
    }, timeoutMs);
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

const readOr = (file, fallback = '') => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
};

// Roda `code` com cada entrada de `inputs`. Retorna compilação + resultado por entrada.
async function execute(code, inputs) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(JOBS_DIR, id);
  const name = `provafap-${id}`;
  fs.mkdirSync(path.join(dir, 'in'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'out'));
  fs.mkdirSync(path.join(dir, 'stub'));
  fs.writeFileSync(path.join(dir, 'main.c'), code);
  for (const h of ['conio.h', 'windows.h']) {
    fs.copyFileSync(path.join(SANDBOX_DIR, h), path.join(dir, 'stub', h));
  }
  fs.copyFileSync(path.join(SANDBOX_DIR, 'run.sh'), path.join(dir, 'run.sh'));
  inputs.forEach((inp, i) => fs.writeFileSync(path.join(dir, 'in', String(i)), inp));
  fs.chmodSync(path.join(dir, 'out'), 0o777);

  const wallMs = 20000 + inputs.length * (TIME_LIMIT + 1) * 1000;
  const res = await docker(
    [
      'run', '--rm', '--name', name,
      '--network', 'none',
      '--memory', '256m', '--memory-swap', '256m',
      '--cpus', '1',
      '--pids-limit', '64',
      '--read-only',
      '--tmpfs', '/tmp:rw,exec,size=64m',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--user', '65534:65534',
      '-e', `TIME_LIMIT=${TIME_LIMIT}`,
      '-v', `${dir}:/job`,
      IMAGE, 'sh', '/job/run.sh',
    ],
    wallMs,
  );
  if (res.killed) await docker(['rm', '-f', name], 10000);

  const out = path.join(dir, 'out');
  const compileCode = Number(readOr(path.join(out, 'compile.code'), '-1').trim());
  const result = {
    compiled: compileCode === 0,
    compileOutput: readOr(path.join(out, 'compile.txt')).replaceAll('/job/main.c', 'main.c').slice(0, 8000),
    infraError: compileCode === -1 ? res.stderr.slice(0, 2000) || 'falha no juiz' : null,
    runs: [],
  };
  if (result.compiled) {
    result.runs = inputs.map((_, i) => {
      const codeStr = readOr(path.join(out, `${i}.code`)).trim();
      const exit = codeStr === '' ? null : Number(codeStr);
      return {
        exit,
        timeout: exit === 124 || exit === 137 || exit === null,
        stdout: readOr(path.join(out, `${i}.out`)),
        stderr: readOr(path.join(out, `${i}.err`)),
        ms: Number(readOr(path.join(out, `${i}.ms`), '0')),
      };
    });
  }
  fs.rm(dir, { recursive: true, force: true }, () => {});
  return result;
}

// ---------- comparação ----------
const tokens = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter(Boolean);

function sameOutput(got, expected) {
  const a = tokens(got);
  const b = tokens(expected);
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

// exit >= 128 (exceto timeout) = morto por sinal: segfault, divisão por zero...
const crashed = (run) => !run.timeout && run.exit !== null && run.exit >= 128;

function runStatus(run, expected) {
  if (run.timeout) return 'Tempo excedido';
  if (expected !== undefined && sameOutput(run.stdout, expected)) return 'Aceito';
  if (crashed(run)) return 'Erro de execução';
  return expected === undefined ? 'Executado' : 'Resposta errada';
}

// ---------- API ----------

// Executar com entrada livre: devolve saída para o aluno ver.
async function run(code, input) {
  const r = await enqueue(() => execute(code, [input]));
  if (r.infraError) return { status: 'Erro no juiz', detail: r.infraError };
  if (!r.compiled) return { status: 'Erro de compilação', compileOutput: r.compileOutput };
  const x = r.runs[0];
  return {
    status: x.timeout ? 'Tempo excedido' : crashed(x) ? 'Erro de execução' : 'Executado',
    stdout: x.stdout.slice(0, 10000),
    stderr: x.stderr.slice(0, 2000),
    ms: x.ms,
    compileOutput: r.compileOutput,
  };
}

// Testar exemplos visíveis: mostra esperado vs obtido.
async function examples(code, cases) {
  const r = await enqueue(() => execute(code, cases.map((c) => c.input)));
  if (r.infraError) return { status: 'Erro no juiz', detail: r.infraError };
  if (!r.compiled) return { status: 'Erro de compilação', compileOutput: r.compileOutput };
  return {
    status: 'ok',
    cases: cases.map((c, i) => ({
      input: c.input,
      expected: c.output,
      got: r.runs[i].stdout.slice(0, 4000),
      verdict: runStatus(r.runs[i], c.output),
    })),
  };
}

// Envio: todos os casos (exemplos + ocultos). Só devolve veredito.
async function submit(code, cases) {
  const r = await enqueue(() => execute(code, cases.map((c) => c.input)));
  if (r.infraError) return { verdict: 'Erro no juiz', detail: r.infraError };
  if (!r.compiled) return { verdict: 'Erro de compilação', compileOutput: r.compileOutput };
  for (let i = 0; i < cases.length; i++) {
    const v = runStatus(r.runs[i], cases[i].output);
    if (v !== 'Aceito') return { verdict: v, failedCase: i };
  }
  return { verdict: 'Aceito' };
}

module.exports = { run, examples, submit, queueSize, sameOutput };
