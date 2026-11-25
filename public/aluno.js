// Cliente do aluno: sessão via WebSocket, editor, execução e trava anti-cola.
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const TEMPLATE = '#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}\n';
  const GRACE_MS = 1500;

  let ws = null;
  let token = storage('get', 'token');
  let session = null; // { student, exam }
  let problems = [];
  let current = null;
  const codes = {};
  let results = {};
  let started = false;
  let locked = false;
  let kicked = false;
  let justUnlocked = false;
  let noFullscreen = false;
  let clockOffset = 0;
  let graceUntil = 0;
  let unloading = false;
  let busy = false;
  let reqSeq = 0;
  let internalClip = '';
  const saveTimers = {};

  function storage(op, key, val) {
    try {
      if (op === 'get') return localStorage.getItem(key);
      if (op === 'set') localStorage.setItem(key, val);
      if (op === 'del') localStorage.removeItem(key);
    } catch {}
    return null;
  }

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- conexão ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      setConn(true);
      if (token) send({ t: 'hello', token });
      else show('login');
    };
    ws.onmessage = (e) => handle(JSON.parse(e.data));
    ws.onclose = () => {
      setConn(false);
      busy = false;
      setBusy(false);
      if (!kicked) setTimeout(connect, 1500);
    };
  }

  function send(msg) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  function setConn(ok) {
    const el = $('#conn');
    el.classList.toggle('ok', ok);
    el.title = ok ? 'Conectado' : 'Sem conexão — tentando reconectar';
  }

  function handle(msg) {
    switch (msg.t) {
      case 'need_login':
        token = null;
        storage('del', 'token');
        return show('login');
      case 'login_error':
        $('#login-error').textContent = msg.msg;
        return;
      case 'session':
        return onSession(msg);
      case 'lock':
        locked = true;
        $('#lock-reason').textContent = msg.reason;
        return render();
      case 'unlock':
        locked = false;
        justUnlocked = true;
        graceUntil = Date.now() + GRACE_MS;
        return render();
      case 'kicked':
        kicked = true;
        return render();
      case 'result':
        return onResult(msg);
    }
  }

  function onSession(msg) {
    token = msg.token;
    storage('set', 'token', token);
    session = msg;
    clockOffset = msg.exam.now - Date.now();
    started = msg.started;
    const pendingViolation = storage('get', 'pendingViolation');
    locked = msg.locked || !!pendingViolation;
    results = msg.results || {};
    $('#lock-reason').textContent = msg.lockReason || '';
    $$('.js-name').forEach((el) => (el.textContent = msg.student.name));

    if (msg.problems && !problems.length) {
      problems = msg.problems;
      for (const p of problems) {
        codes[p.id] = codes[p.id] ?? msg.codes[p.id] ?? storage('get', draftKey(p.id)) ?? TEMPLATE;
      }
      buildSidebar();
      selectProblem(problems[0].id);
    }

    // Violação que aconteceu sem conexão: reporta agora.
    if (pendingViolation) {
      storage('del', 'pendingViolation');
      if (!msg.locked) send({ t: 'violation', reason: pendingViolation });
    }
    updateScore();
    render();
  }

  // ---------- telas ----------
  function show(id) {
    for (const s of ['login', 'wait', 'exam', 'ended']) $(`#screen-${s}`).hidden = s !== id;
  }

  const isFullscreen = () => !!document.fullscreenElement;
  const examRunning = () => session && session.exam.status === 'running' && serverNow() < session.exam.endsAt;
  const serverNow = () => Date.now() + clockOffset;

  function render() {
    $('#kicked').hidden = !kicked;
    if (kicked || !session) return;
    const status = session.exam.status;
    if (status === 'waiting') {
      show('wait');
      $('#gate').hidden = $('#lock').hidden = true;
      return;
    }
    if (status === 'ended' || !examRunning()) {
      show('ended');
      $('#gate').hidden = $('#lock').hidden = true;
      $('#ended-score').textContent = `${countAccepted()} de ${problems.length} desafios aceitos`;
      editor.setReadOnly(true);
      return;
    }
    const wasHidden = $('#screen-exam').hidden;
    show('exam');
    // CodeMirror criado com a tela oculta não mede nada: redesenha ao aparecer.
    if (wasHidden) editor.refresh();
    $('#lock').hidden = !locked;
    $('#gate').hidden = locked || isFullscreen() || noFullscreen;
    const [title, text] = !started
      ? ['Pronto para começar?', 'A prova abre em tela cheia. A partir daqui, sair da tela cheia, trocar de aba ou usar Alt+Tab trava a prova.']
      : justUnlocked
        ? ['Prova liberada', 'O professor liberou sua prova. Clique para voltar à tela cheia.']
        : ['Continuar a prova', 'Clique para voltar à tela cheia. Lembre-se: sair dela trava a prova.'];
    $('#gate-title').textContent = title;
    $('#gate-msg').textContent = text;
    editor.setReadOnly(locked);
    if (!$('#gate').hidden || !$('#lock').hidden) editor.blur();
  }

  // ---------- trava ----------
  const armed = () => examRunning() && started && !locked && !unloading && Date.now() > graceUntil;

  function violation(reason) {
    if (!armed()) return;
    locked = true;
    $('#lock-reason').textContent = reason;
    render();
    if (!send({ t: 'violation', reason })) storage('set', 'pendingViolation', reason);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') violation('trocou de aba ou minimizou o navegador');
  });
  window.addEventListener('blur', (e) => {
    if (e.target === window) violation('saiu da janela da prova (Alt+Tab ou outro programa)');
  });
  document.addEventListener('fullscreenchange', () => {
    if (!isFullscreen()) violation('saiu da tela cheia');
    render();
  });
  window.addEventListener('beforeunload', () => {
    unloading = true;
    flushSaves();
  });

  $('#gate-btn').addEventListener('click', async () => {
    graceUntil = Date.now() + GRACE_MS;
    try {
      await Promise.race([
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('sem resposta em 2s')), 2000)),
      ]);
    } catch (err) {
      // Navegador recusou tela cheia: segue sem ela (trava por aba/foco continua) e avisa o professor.
      noFullscreen = true;
      send({ t: 'event', kind: 'tela cheia indisponível', detail: String(err && err.message).slice(0, 120) });
    }
    graceUntil = Date.now() + GRACE_MS;
    justUnlocked = false;
    if (!started) {
      started = true;
      send({ t: 'started' });
    }
    render();
    editor.focus();
  });

  // Dissuasores: menu de contexto e atalhos de DevTools/código-fonte.
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const devtools =
      e.key === 'F12' ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(k)) ||
      ((e.ctrlKey || e.metaKey) && k === 'u');
    if (devtools) {
      e.preventDefault();
      send({ t: 'event', kind: 'atalho bloqueado', detail: `${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.key}` });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('#screen-exam').hidden) {
      e.preventDefault();
      runCode();
    }
  });

  // ---------- editor ----------
  const editor = createEditor($('#editor'));

  function createEditor(textarea) {
    if (window.CodeMirror) {
      const cm = CodeMirror.fromTextArea(textarea, {
        mode: 'text/x-csrc',
        theme: 'material-darker',
        lineNumbers: true,
        indentUnit: 4,
        tabSize: 4,
        matchBrackets: true,
        autofocus: false,
        spellcheck: false,
        autocorrect: false,
        extraKeys: { Tab: (c) => c.replaceSelection('    ') },
      });
      const remember = (c) => (internalClip = c.getSelection());
      cm.on('copy', remember);
      cm.on('cut', remember);
      cm.on('beforeChange', (c, change) => {
        if (change.origin === 'paste' || change.origin === 'drop') {
          const text = change.text.join('\n');
          if (normalizeClip(text) !== normalizeClip(internalClip)) {
            change.cancel();
            send({ t: 'event', kind: 'colar bloqueado', detail: text.slice(0, 120) });
            flash('Colar texto de fora do editor não é permitido.');
          }
        }
      });
      return {
        get: () => cm.getValue(),
        set: (v) => {
          cm.setValue(v);
          cm.clearHistory();
        },
        setReadOnly: (ro) => cm.setOption('readOnly', ro ? 'nocursor' : false),
        onChange: (fn) => cm.on('change', (c, ch) => ch.origin !== 'setValue' && fn()),
        focus: () => cm.focus(),
        blur: () => cm.getInputField().blur(),
        refresh: () => cm.refresh(),
      };
    }
    // Fallback se o CDN do CodeMirror falhar.
    textarea.classList.add('plain-editor');
    textarea.spellcheck = false;
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        textarea.setRangeText('    ', textarea.selectionStart, textarea.selectionEnd, 'end');
        textarea.dispatchEvent(new Event('input'));
      }
    });
    const remember = () => (internalClip = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd));
    textarea.addEventListener('copy', remember);
    textarea.addEventListener('cut', remember);
    textarea.addEventListener('paste', (e) => {
      const text = e.clipboardData.getData('text');
      if (normalizeClip(text) !== normalizeClip(internalClip)) {
        e.preventDefault();
        send({ t: 'event', kind: 'colar bloqueado', detail: text.slice(0, 120) });
        flash('Colar texto de fora do editor não é permitido.');
      }
    });
    textarea.addEventListener('drop', (e) => e.preventDefault());
    return {
      get: () => textarea.value,
      set: (v) => (textarea.value = v),
      setReadOnly: (ro) => (textarea.readOnly = ro),
      onChange: (fn) => textarea.addEventListener('input', fn),
      focus: () => textarea.focus(),
      blur: () => textarea.blur(),
      refresh: () => {},
    };
  }

  const normalizeClip = (s) => s.replace(/\r\n/g, '\n').trim();

  const draftKey = (pid) => `draft:${session?.student.ra}:${pid}`;

  editor.onChange(() => {
    if (!current) return;
    const pid = current;
    codes[pid] = editor.get();
    storage('set', draftKey(pid), codes[pid]);
    clearTimeout(saveTimers[pid]);
    saveTimers[pid] = setTimeout(() => saveCode(pid), 2000);
  });

  function saveCode(pid) {
    delete saveTimers[pid];
    send({ t: 'save', pid, code: codes[pid] });
  }

  function flushSaves() {
    for (const pid of Object.keys(saveTimers)) {
      clearTimeout(saveTimers[pid]);
      saveCode(pid);
    }
  }

  // ---------- desafios ----------
  function buildSidebar() {
    $('#problem-list').innerHTML = problems
      .map(
        (p, i) =>
          `<button class="prob" data-pid="${p.id}"><span class="st" data-st="${p.id}"></span><span>${i + 1}. ${esc(p.title)}</span></button>`,
      )
      .join('');
    $$('.prob').forEach((b) => b.addEventListener('click', () => selectProblem(b.dataset.pid)));
    updateStatusIcons();
  }

  function selectProblem(pid) {
    if (current && saveTimers[current]) {
      clearTimeout(saveTimers[current]);
      saveCode(current);
    }
    current = pid;
    const p = problems.find((x) => x.id === pid);
    const idx = problems.indexOf(p) + 1;
    $$('.prob').forEach((b) => b.classList.toggle('active', b.dataset.pid === pid));
    $('#statement').innerHTML = `
      <h2>Desafio ${idx} — ${esc(p.title)}</h2>
      ${p.statement}
      ${p.examples
        .map(
          (ex, i) => `
        <div class="example">
          <div class="ex-title">Exemplo ${i + 1}</div>
          <div class="ex-grid">
            <div><span>Entrada</span><pre>${ex.input ? esc(ex.input) : '<i class="muted">(sem entrada)</i>'}</pre></div>
            <div><span>Saída</span><pre>${esc(ex.output)}</pre></div>
          </div>
        </div>`,
        )
        .join('')}`;
    editor.set(codes[pid]);
    $('#input').value = p.examples[0]?.input || '';
    $('#output').innerHTML = resultSummary(pid);
  }

  function resultSummary(pid) {
    const r = results[pid];
    if (!r) return '<p class="muted">Execute ou envie para ver o resultado.</p>';
    if (r.accepted) return `<div class="verdict ok">✔ Aceito</div><p class="muted">${r.attempts} envio(s).</p>`;
    return `<p class="muted">Último envio: <b>${esc(r.last)}</b> (${r.attempts} envio(s)).</p>`;
  }

  const countAccepted = () => Object.values(results).filter((r) => r.accepted).length;

  function updateScore() {
    if (!problems.length) return;
    $('#score').textContent = `${countAccepted()}/${problems.length} aceitos`;
    updateStatusIcons();
  }

  function updateStatusIcons() {
    $$('[data-st]').forEach((el) => {
      const r = results[el.dataset.st];
      el.className = 'st ' + (r?.accepted ? 'ok' : r ? 'bad' : '');
      el.textContent = r?.accepted ? '✔' : r ? '✘' : '';
    });
  }

  // ---------- executar / enviar ----------
  function request(kind, extra = {}) {
    if (busy || !current) return;
    if (!examRunning()) return;
    flushSaves();
    const reqId = ++reqSeq;
    const ok = send({ t: kind, reqId, pid: current, code: codes[current], ...extra });
    if (!ok) {
      $('#output').innerHTML = '<p class="error">Sem conexão com o servidor. Aguarde reconectar.</p>';
      return;
    }
    busy = true;
    setBusy(true);
    const label = { run: 'Executando…', examples: 'Testando exemplos…', submit: 'Corrigindo com casos ocultos…' }[kind];
    $('#output').innerHTML = `<p class="muted spin">${label}</p>`;
  }

  const runCode = () => request('run', { input: $('#input').value });
  $('#btn-run').addEventListener('click', runCode);
  $('#btn-examples').addEventListener('click', () => request('examples'));
  $('#btn-submit').addEventListener('click', () => request('submit'));

  function setBusy(b) {
    ['#btn-run', '#btn-examples', '#btn-submit'].forEach((s) => ($(s).disabled = b));
  }

  function onResult(msg) {
    busy = false;
    setBusy(false);
    if (msg.kind === 'submit' && msg.verdict) {
      results[msg.pid] = { accepted: msg.accepted, attempts: msg.attempts, last: msg.verdict };
      updateScore();
    }
    if (msg.pid !== current) return;
    const out = $('#output');
    if (msg.error) {
      out.innerHTML = `<p class="error">${esc(msg.error)}</p>`;
      return;
    }
    const compile = msg.compileOutput && msg.status === 'Erro de compilação'
      ? `<div class="verdict bad">Erro de compilação</div><pre class="err">${esc(msg.compileOutput)}</pre>`
      : null;

    if (msg.kind === 'run') {
      if (compile) return (out.innerHTML = compile);
      const cls = msg.status === 'Executado' ? 'neutral' : 'bad';
      out.innerHTML = `
        <div class="verdict ${cls}">${esc(msg.status)} <small>${msg.ms ?? ''} ms</small></div>
        <pre>${msg.stdout ? esc(msg.stdout) : '<i class="muted">(nenhuma saída)</i>'}</pre>
        ${msg.stderr ? `<pre class="err">${esc(msg.stderr)}</pre>` : ''}`;
      return;
    }

    if (msg.kind === 'examples') {
      if (compile) return (out.innerHTML = compile);
      out.innerHTML = msg.cases
        .map(
          (c, i) => `
        <div class="case ${c.verdict === 'Aceito' ? 'ok' : 'bad'}">
          <div class="case-title">${c.verdict === 'Aceito' ? '✔' : '✘'} Exemplo ${i + 1} — ${esc(c.verdict)}</div>
          ${c.verdict === 'Aceito' ? '' : `
          <div class="ex-grid three">
            <div><span>Entrada</span><pre>${esc(c.input) || '<i class="muted">(vazia)</i>'}</pre></div>
            <div><span>Esperado</span><pre>${esc(c.expected)}</pre></div>
            <div><span>Sua saída</span><pre>${esc(c.got) || '<i class="muted">(vazia)</i>'}</pre></div>
          </div>`}
        </div>`,
        )
        .join('');
      return;
    }

    // submit
    if (msg.verdict === 'Aceito') {
      out.innerHTML = '<div class="verdict ok big">✔ Aceito</div><p>Solução correta em todos os casos de teste.</p>';
    } else if (msg.verdict === 'Erro de compilação') {
      out.innerHTML = compile || `<div class="verdict bad">Erro de compilação</div><pre class="err">${esc(msg.compileOutput || '')}</pre>`;
    } else {
      out.innerHTML = `<div class="verdict bad big">✘ Não aceito</div><p>${esc(msg.verdict)} em algum caso de teste.${
        msg.accepted ? ' (Você já tem este desafio aceito; ele continua valendo.)' : ''
      }</p>`;
    }
  }

  // ---------- login ----------
  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    const ok = send({
      t: 'login',
      name: $('#login-name').value,
      ra: $('#login-ra').value,
      name2: $('#login-name2').value,
      ra2: $('#login-ra2').value,
      code: $('#login-code').value,
    });
    if (!ok) $('#login-error').textContent = 'Sem conexão com o servidor.';
  });

  // ---------- utilidades ----------
  let flashTimer;
  function flash(text) {
    let el = $('#flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'flash';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  setInterval(() => {
    if (!session || session.exam.status !== 'running') return;
    const left = Math.max(0, session.exam.endsAt - serverNow());
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    $('#timer').textContent = `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    $('#timer').classList.toggle('warn', left < 5 * 60000);
    if (left === 0) render();
  }, 500);

  connect();
})();
