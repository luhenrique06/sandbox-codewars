// Servidor da prova: arquivos estáticos + WebSocket (aluno e professor).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const judge = require('./judge');
const { problems, byId, publicProblems } = require('./problems');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASS = process.env.ADMIN_PASS;
const EXAM_CODE = (process.env.EXAM_CODE || '').trim().toUpperCase();
const OFFLINE_LOCK_SECS = Number(process.env.OFFLINE_LOCK_SECS || 15);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.log');
const MAX_CODE = 64 * 1024;
const MAX_INPUT = 16 * 1024;

if (!ADMIN_PASS || !EXAM_CODE) {
  console.error('Defina ADMIN_PASS e EXAM_CODE. Ex: ADMIN_PASS=segredo EXAM_CODE=TP2026 node server.js');
  process.exit(1);
}

// ---------- estado ----------
fs.mkdirSync(DATA_DIR, { recursive: true });

let state = { exam: { status: 'waiting', startedAt: null, endsAt: null }, students: {} };
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  for (const s of Object.values(state.students)) {
    s.online = false;
    s.offlineSince = null; // servidor reiniciou: não travar todo mundo na reconexão
    s.busy = false;
  }
  console.log(`Estado carregado: ${Object.keys(state.students).length} alunos, prova ${state.exam.status}`);
} catch {
  console.log('Estado novo');
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_FILE);
  }, 1000);
}

function logEvent(student, kind, detail = '') {
  const ev = { at: Date.now(), kind, detail };
  student.events.push(ev);
  if (student.events.length > 500) student.events.shift();
  student.lastEvent = ev;
  fs.appendFile(
    EVENTS_FILE,
    `${new Date(ev.at).toISOString()}\t${memberRas(student).join('+')}\t${displayName(student)}\t${kind}\t${detail}\n`,
    () => {},
  );
  save();
  notifyAdmins();
}

const memberRas = (s) => [s.ra, s.partner?.ra].filter(Boolean);
const displayName = (s) => (s.partner ? `${s.name} / ${s.partner.name}` : s.name);
const findTeam = (ra) => Object.values(state.students).find((s) => memberRas(s).includes(ra));

const examOpen = () => state.exam.status === 'running' && Date.now() < state.exam.endsAt;

function score(s) {
  return problems.filter((p) => s.results[p.id]?.accepted).length;
}

// ---------- conexões ----------
const studentSockets = new Map(); // ra -> ws
const adminSockets = new Set();

const send = (ws, msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));

function examPayload() {
  return { status: state.exam.status, endsAt: state.exam.endsAt, now: Date.now() };
}

function sessionPayload(s) {
  const visible = state.exam.status !== 'waiting';
  return {
    t: 'session',
    token: s.token,
    student: { name: displayName(s), ra: s.ra },
    exam: examPayload(),
    problems: visible ? publicProblems() : null,
    codes: s.code,
    results: Object.fromEntries(
      Object.entries(s.results).map(([id, r]) => [id, { accepted: r.accepted, attempts: r.attempts, last: r.last }]),
    ),
    started: s.started,
    locked: s.locked,
    lockReason: s.lockReason,
  };
}

function broadcastExam() {
  for (const [ra, ws] of studentSockets) {
    const s = state.students[ra];
    if (s) send(ws, sessionPayload(s));
  }
  notifyAdmins();
}

// ---------- painel: snapshot ----------
let adminTimer = null;
function notifyAdmins() {
  if (adminTimer) return;
  adminTimer = setTimeout(() => {
    adminTimer = null;
    const msg = adminSnapshot();
    for (const ws of adminSockets) send(ws, msg);
  }, 300);
}

function adminSnapshot() {
  return {
    t: 'snapshot',
    exam: examPayload(),
    queue: judge.queueSize(),
    problems: problems.map((p) => ({ id: p.id, title: p.title })),
    students: Object.values(state.students)
      .map((s) => ({
        ra: s.ra,
        name: displayName(s),
        members: [{ ra: s.ra, name: s.name }, ...(s.partner ? [s.partner] : [])],
        online: s.online,
        started: s.started,
        locked: s.locked,
        lockReason: s.lockReason,
        lockCount: s.lockCount,
        score: score(s),
        results: Object.fromEntries(
          Object.entries(s.results).map(([id, r]) => [id, { accepted: r.accepted, attempts: r.attempts }]),
        ),
        lastEvent: s.lastEvent,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ---------- trava ----------
function lock(s, reason) {
  if (s.locked) return;
  s.locked = true;
  s.lockReason = reason;
  s.lockCount = (s.lockCount || 0) + 1;
  logEvent(s, 'TRAVADO', reason);
  send(studentSockets.get(s.ra), { t: 'lock', reason });
}

function unlock(s, by = 'professor') {
  if (!s.locked) return;
  s.locked = false;
  s.lockReason = null;
  logEvent(s, 'liberado', by);
  send(studentSockets.get(s.ra), { t: 'unlock' });
}

// ---------- timer da prova ----------
setInterval(() => {
  if (state.exam.status === 'running' && Date.now() >= state.exam.endsAt) {
    state.exam.status = 'ended';
    console.log('Tempo esgotado: prova encerrada');
    save();
    broadcastExam();
  }
}, 1000);

// ---------- mensagens do aluno ----------
async function onStudentMessage(ws, ctx, msg) {
  if (msg.t === 'login' || msg.t === 'hello') {
    let s;
    if (msg.t === 'hello') {
      s = Object.values(state.students).find((x) => x.token && x.token === msg.token);
      if (!s) return send(ws, { t: 'need_login' });
    } else {
      const cleanName = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const cleanRa = (v) => String(v || '').replace(/\s+/g, '').slice(0, 30);
      const name = cleanName(msg.name);
      const ra = cleanRa(msg.ra);
      const name2 = cleanName(msg.name2);
      const ra2 = cleanRa(msg.ra2);
      const code = String(msg.code || '').trim().toUpperCase();
      const fail = (text) => send(ws, { t: 'login_error', msg: text });
      if (!name || !ra) return fail('Preencha seu nome e RA.');
      if (!name2 !== !ra2) return fail('Para prova em dupla, preencha nome e RA do segundo aluno (ou deixe os dois em branco).');
      if (ra2 && ra2 === ra) return fail('Os dois RAs são iguais.');
      if (code !== EXAM_CODE) return fail('Código da prova incorreto.');

      // Equipe = 1 ou 2 alunos. Cada RA pertence a uma única equipe.
      const teams = [...new Set([findTeam(ra), ra2 && findTeam(ra2)].filter(Boolean))];
      if (teams.length > 1) return fail(`RA ${ra} e RA ${ra2} já estão em equipes diferentes. Chame o professor.`);
      s = teams[0];
      if (!s) {
        s = state.students[ra] = {
          ra, name, partner: ra2 ? { ra: ra2, name: name2 } : null,
          token: null, code: {}, results: {}, submissions: [], events: [],
          started: false, locked: false, lockReason: null, lockCount: 0, online: false, offlineSince: null,
        };
        logEvent(s, 'cadastro', displayName(s));
      } else {
        const newcomer = [[ra, name], [ra2, name2]].find(([r]) => r && !memberRas(s).includes(r));
        if (newcomer) {
          // Completar a dupla só antes de começar: impede alguém de "entrar" na equipe de um colega no meio da prova.
          if (s.partner || s.started) {
            return fail(`RA ${newcomer[0]} não faz parte da equipe de ${displayName(s)}. Chame o professor.`);
          }
          s.partner = { ra: newcomer[0], name: newcomer[1] };
          logEvent(s, 'dupla adicionada', s.partner.name);
        }
      }
      s.token = crypto.randomBytes(16).toString('hex');
    }

    // Sessão anterior do mesmo RA em outra aba/máquina é derrubada.
    const old = studentSockets.get(s.ra);
    if (old && old !== ws) {
      send(old, { t: 'kicked' });
      old.close();
      logEvent(s, 'sessão substituída', 'login em outro navegador/aba');
    }

    ctx.ra = s.ra;
    studentSockets.set(s.ra, ws);
    const offlineFor = s.offlineSince ? Math.round((Date.now() - s.offlineSince) / 1000) : 0;
    s.online = true;
    s.offlineSince = null;
    logEvent(s, msg.t === 'login' ? 'login' : 'reconectou', offlineFor ? `offline ${offlineFor}s` : '');
    if (examOpen() && s.started && offlineFor > OFFLINE_LOCK_SECS) {
      lock(s, `ficou offline ${offlineFor}s`);
    }
    return send(ws, sessionPayload(s));
  }

  const s = ctx.ra && state.students[ctx.ra];
  if (!s || studentSockets.get(s.ra) !== ws) return send(ws, { t: 'need_login' });

  switch (msg.t) {
    case 'started':
      if (examOpen() && !s.started) {
        s.started = true;
        logEvent(s, 'iniciou prova');
      }
      return;

    case 'violation':
      if (examOpen() && s.started) lock(s, String(msg.reason || 'saiu da prova').slice(0, 120));
      return;

    case 'event':
      return logEvent(s, String(msg.kind || 'evento').slice(0, 60), String(msg.detail || '').slice(0, 200));

    case 'save': {
      if (!examOpen() || !byId[msg.pid] || typeof msg.code !== 'string' || msg.code.length > MAX_CODE) return;
      s.code[msg.pid] = msg.code;
      return save();
    }

    case 'run':
    case 'examples':
    case 'submit': {
      const reply = (data) => send(ws, { t: 'result', kind: msg.t, reqId: msg.reqId, pid: msg.pid, ...data });
      const p = byId[msg.pid];
      if (!p || typeof msg.code !== 'string') return reply({ error: 'Pedido inválido.' });
      if (msg.code.length > MAX_CODE) return reply({ error: 'Código muito grande.' });
      if (!examOpen()) return reply({ error: 'A prova não está aberta.' });
      if (s.locked) return reply({ error: 'Prova bloqueada. Chame o professor.' });
      if (s.busy) return reply({ error: 'Aguarde a execução anterior terminar.' });
      s.code[p.id] = msg.code;
      save();
      s.busy = true;
      try {
        if (msg.t === 'run') {
          const input = String(msg.input || '').slice(0, MAX_INPUT);
          return reply(await judge.run(msg.code, input.endsWith('\n') || !input ? input : input + '\n'));
        }
        if (msg.t === 'examples') return reply(await judge.examples(msg.code, p.examples));

        const r = await judge.submit(msg.code, [...p.examples, ...p.tests]);
        if (r.verdict === 'Erro no juiz') return reply({ error: 'Erro no juiz, tente novamente.' });
        const res = (s.results[p.id] ||= { accepted: false, attempts: 0, last: null });
        res.attempts++;
        res.last = r.verdict;
        if (r.verdict === 'Aceito') res.accepted = true;
        s.submissions.push({ at: Date.now(), pid: p.id, verdict: r.verdict, failedCase: r.failedCase, code: msg.code });
        logEvent(s, 'envio', `${p.id}: ${r.verdict}`);
        return reply({ verdict: r.verdict, compileOutput: r.compileOutput, accepted: res.accepted, attempts: res.attempts });
      } finally {
        s.busy = false;
      }
    }
  }
}

function onStudentClose(ws, ctx) {
  const s = ctx.ra && state.students[ctx.ra];
  if (!s || studentSockets.get(s.ra) !== ws) return;
  studentSockets.delete(s.ra);
  s.online = false;
  s.offlineSince = Date.now();
  logEvent(s, 'desconectou');
}

// ---------- mensagens do professor ----------
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function onAdminMessage(ws, ctx, msg) {
  if (msg.t === 'admin_login') {
    if (!safeEqual(msg.pass, ADMIN_PASS)) return send(ws, { t: 'admin_error', msg: 'Senha incorreta.' });
    ctx.admin = true;
    adminSockets.add(ws);
    return send(ws, adminSnapshot());
  }
  if (!ctx.admin) return send(ws, { t: 'admin_error', msg: 'Não autenticado.' });

  const s = msg.ra && state.students[msg.ra];
  switch (msg.t) {
    case 'start': {
      const minutes = Math.max(1, Math.min(600, Number(msg.minutes) || 120));
      state.exam = { status: 'running', startedAt: Date.now(), endsAt: Date.now() + minutes * 60000 };
      console.log(`Prova iniciada: ${minutes} min`);
      save();
      return broadcastExam();
    }
    case 'extend': {
      if (state.exam.status === 'waiting') return;
      const minutes = Number(msg.minutes) || 5;
      const base = state.exam.status === 'running' ? state.exam.endsAt : Date.now();
      state.exam.endsAt = base + minutes * 60000;
      state.exam.status = 'running';
      save();
      return broadcastExam();
    }
    case 'end':
      state.exam.status = 'ended';
      state.exam.endsAt = Math.min(state.exam.endsAt || Date.now(), Date.now());
      save();
      return broadcastExam();
    case 'unlock':
      if (s) unlock(s);
      return;
    case 'unlock_all':
      Object.values(state.students).forEach((x) => unlock(x, 'professor (todos)'));
      return;
    case 'detail':
      if (!s) return;
      return send(ws, {
        t: 'detail',
        student: {
          ra: s.ra,
          name: displayName(s),
          members: memberRas(s),
          code: s.code,
          results: s.results,
          submissions: s.submissions.map(({ at, pid, verdict, failedCase, code }) => ({ at, pid, verdict, failedCase, code })),
          events: s.events,
        },
      });
    case 'similarity':
      return send(ws, { t: 'similarity', pairs: similarity() });
  }
}

// ---------- similaridade de código ----------
// Normaliza (sem comentários, strings, espaços; identificadores viram "id") e compara trigramas de tokens.
const C_WORDS = new Set(
  'int float double char void if else for while do return break continue switch case default long short unsigned signed const struct include define main printf scanf'.split(' '),
);

function codeTokens(code) {
  const src = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' STR ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' CHR ');
  return (src.match(/[A-Za-z_]\w*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||\+\+|--|[+\-*/%=<>!(){}\[\];,&]/g) || []).map((t) =>
    /^[A-Za-z_]/.test(t) && !C_WORDS.has(t) ? 'id' : /^\d/.test(t) ? 'num' : t,
  );
}

// Desafios simples saem parecidos por natureza; por isso compara a prova inteira de cada aluno
// (trigramas prefixados pelo desafio) e só considera quem escreveu ao menos 3 desafios.
function examShingles(s) {
  const set = new Set();
  let coded = 0;
  for (const p of problems) {
    const toks = codeTokens(s.code[p.id] || '');
    if (toks.length < 15) continue;
    coded++;
    for (let i = 0; i + 3 <= toks.length; i++) set.add(`${p.id}|${toks.slice(i, i + 3).join(' ')}`);
  }
  return { set, coded };
}

function similarity() {
  const items = Object.values(state.students)
    .map((s) => ({ s, ...examShingles(s) }))
    .filter((x) => x.coded >= 3);
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].set;
      const b = items[j].set;
      let inter = 0;
      for (const x of a) if (b.has(x)) inter++;
      const sim = inter / (a.size + b.size - inter);
      pairs.push({ a: displayName(items[i].s), raA: memberRas(items[i].s).join(' / '), b: displayName(items[j].s), raB: memberRas(items[j].s).join(' / '), sim: Math.round(sim * 100) });
    }
  }
  return pairs.sort((x, y) => y.sim - x.sim).slice(0, 30);
}

// ---------- HTTP + WS ----------
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (ws) => {
  const ctx = { ra: null, admin: false };
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      if (msg.t === 'admin_login' || ctx.admin) onAdminMessage(ws, ctx, msg);
      else await onStudentMessage(ws, ctx, msg);
    } catch (err) {
      console.error('Erro ao processar mensagem', msg.t, err);
    }
  });
  ws.on('close', () => {
    adminSockets.delete(ws);
    onStudentClose(ws, ctx);
  });
});

// Ping mantém conexão viva no ngrok e derruba clientes mortos.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// Fila do juiz muda sem eventos: atualiza painel periodicamente.
setInterval(() => adminSockets.size && notifyAdmins(), 3000);

server.listen(PORT, () => {
  console.log(`Prova rodando em http://localhost:${PORT}  (painel: /admin)`);
  console.log(`Código da prova: ${EXAM_CODE}`);
});

function shutdown() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
