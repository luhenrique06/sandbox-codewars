// Painel do professor: acompanha alunos, libera travas, exporta notas.
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtTime = (t) => new Date(t).toLocaleTimeString('pt-BR');

  let ws = null;
  let pass = sessionStorage.getItem('adminPass') || '';
  let snap = null;
  let clockOffset = 0;
  let lockCounts = {};
  let openRa = null;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      $('#conn').classList.add('ok');
      if (pass) send({ t: 'admin_login', pass });
    };
    ws.onclose = () => {
      $('#conn').classList.remove('ok');
      setTimeout(connect, 1500);
    };
    ws.onmessage = (e) => handle(JSON.parse(e.data));
  }

  const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

  function handle(msg) {
    if (msg.t === 'admin_error') {
      $('#login-error').textContent = msg.msg;
      $('#screen-login').hidden = false;
      $('#screen-panel').hidden = true;
      return;
    }
    if (msg.t === 'snapshot') {
      sessionStorage.setItem('adminPass', pass);
      $('#screen-login').hidden = true;
      $('#screen-panel').hidden = false;
      snap = msg;
      clockOffset = msg.exam.now - Date.now();
      detectNewLocks();
      render();
      return;
    }
    if (msg.t === 'detail') return showDetail(msg.student);
    if (msg.t === 'similarity') return showSimilarity(msg.pairs);
  }

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    pass = $('#pass').value;
    $('#login-error').textContent = '';
    send({ t: 'admin_login', pass });
  });

  // ---------- alerta de nova trava ----------
  function detectNewLocks() {
    let fresh = 0;
    for (const s of snap.students) {
      if ((s.lockCount || 0) > (lockCounts[s.ra] ?? s.lockCount ?? 0)) fresh++;
      lockCounts[s.ra] = s.lockCount || 0;
    }
    if (fresh && $('#sound').checked) beep();
    const locked = snap.students.filter((s) => s.locked).length;
    document.title = locked ? `🔒 ${locked} travado(s) — Painel` : 'Painel da Prova';
  }

  function beep() {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.35);
    } catch {}
  }

  // ---------- render ----------
  const statusLabel = { waiting: 'aguardando início', running: 'em andamento', ended: 'encerrada' };

  function render() {
    const { exam, students, problems } = snap;
    const tag = $('#exam-status');
    tag.textContent = statusLabel[exam.status];
    tag.className = 'tag ' + (exam.status === 'running' ? 'on' : exam.status === 'ended' ? 'lk' : 'wait');
    $('#btn-start').textContent = exam.status === 'waiting' ? 'Iniciar prova' : 'Reiniciar cronômetro';

    $('#st-total').textContent = students.reduce((a, s) => a + s.members.length, 0);
    $('#st-teams').textContent = students.length;
    $('#st-online').textContent = students.filter((s) => s.online).length;
    $('#st-locked').textContent = students.filter((s) => s.locked).length;
    $('#st-avg').textContent = students.length
      ? (students.reduce((a, s) => a + s.score, 0) / students.length).toFixed(1)
      : '–';
    $('#st-queue').textContent = snap.queue;

    $('#thead').innerHTML = `<tr><th>#</th><th>Aluno(s)</th><th>RA</th><th>Status</th><th class="c">Travas</th>${problems
      .map((p, i) => `<th class="c" title="${esc(p.title)}">D${i + 1}</th>`)
      .join('')}<th class="c">Nota</th><th>Último evento</th><th></th></tr>`;

    $('#tbody').innerHTML = students
      .map((s, i) => {
        const status = s.locked
          ? `<span class="tag lk" title="${esc(s.lockReason)}">🔒 travado</span>`
          : !s.online
            ? '<span class="tag off">offline</span>'
            : s.started
              ? '<span class="tag on">fazendo</span>'
              : '<span class="tag wait">online</span>';
        const cells = problems
          .map((p) => {
            const r = s.results[p.id];
            if (!r) return '<td class="c muted">–</td>';
            return r.accepted
              ? `<td class="c yes" title="${r.attempts} envio(s)">✔</td>`
              : `<td class="c no" title="${r.attempts} envio(s)">✘${r.attempts}</td>`;
          })
          .join('');
        const ev = s.lastEvent ? `${fmtTime(s.lastEvent.at)} ${s.lastEvent.kind} ${s.lastEvent.detail || ''}` : '';
        return `<tr class="clickable ${s.locked ? 'locked' : ''} ${s.online ? '' : 'offline'}" data-ra="${esc(s.ra)}">
          <td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.members.map((m) => m.ra).join(' / '))}</td><td>${status}</td>
          <td class="c">${s.lockCount || 0}</td>${cells}<td class="c"><b>${s.score}</b></td>
          <td class="ev" title="${esc(ev)}">${esc(ev)}</td>
          <td>${s.locked ? `<button class="btn primary js-unlock" data-ra="${esc(s.ra)}">Liberar</button>` : ''}</td>
        </tr>`;
      })
      .join('');

    $$('.js-unlock').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        send({ t: 'unlock', ra: b.dataset.ra });
      }),
    );
    $$('tr.clickable').forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.ra)));

    if (openRa) {
      const s = students.find((x) => x.ra === openRa);
      $('#modal-unlock').hidden = !s?.locked;
    }
  }

  setInterval(() => {
    if (!snap) return;
    const { exam } = snap;
    if (exam.status !== 'running') return ($('#exam-timer').textContent = '');
    const left = Math.max(0, exam.endsAt - (Date.now() + clockOffset));
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    $('#exam-timer').textContent = `restam ${m}:${String(s).padStart(2, '0')}`;
  }, 500);

  // ---------- controles ----------
  // Ações destrutivas pedem segundo clique (sem diálogos do navegador).
  function confirmClick(btn, label, action) {
    btn.addEventListener('click', () => {
      if (btn.dataset.armed) {
        delete btn.dataset.armed;
        btn.textContent = btn.dataset.orig;
        action();
        return;
      }
      btn.dataset.orig = btn.textContent;
      btn.dataset.armed = '1';
      btn.textContent = label;
      setTimeout(() => {
        if (btn.dataset.armed) {
          delete btn.dataset.armed;
          btn.textContent = btn.dataset.orig;
        }
      }, 3000);
    });
  }

  confirmClick($('#btn-start'), 'Clique de novo para confirmar', () =>
    send({ t: 'start', minutes: Number($('#duration').value) }),
  );
  confirmClick($('#btn-end'), 'Clique de novo para ENCERRAR', () => send({ t: 'end' }));
  $$('.js-extend').forEach((b) => b.addEventListener('click', () => send({ t: 'extend', minutes: Number(b.dataset.min) })));
  $('#btn-unlock-all').addEventListener('click', () => send({ t: 'unlock_all' }));
  $('#btn-sim').addEventListener('click', () => send({ t: 'similarity' }));

  $('#btn-csv').addEventListener('click', () => {
    if (!snap) return;
    const { problems, students } = snap;
    // Uma linha por aluno: os dois da dupla recebem a mesma nota.
    const head = ['RA', 'Nome', 'Dupla', ...problems.map((_, i) => `D${i + 1}`), 'Nota', 'Travamentos'];
    const rows = students.flatMap((s) =>
      s.members.map((m) => [
        m.ra,
        m.name,
        s.members.filter((o) => o.ra !== m.ra).map((o) => o.name).join(''),
        ...problems.map((p) => (s.results[p.id]?.accepted ? 1 : 0)),
        s.score,
        s.lockCount || 0,
      ]),
    );
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `notas-prova-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- detalhe do aluno ----------
  function openDetail(ra) {
    openRa = ra;
    send({ t: 'detail', ra });
  }

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => e.target.id === 'modal' && closeModal());
  $('#modal-unlock').addEventListener('click', () => openRa && send({ t: 'unlock', ra: openRa }));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());

  function closeModal() {
    $('#modal').hidden = true;
    openRa = null;
  }

  function showDetail(st) {
    if (openRa !== st.ra) return;
    const s = snap.students.find((x) => x.ra === st.ra);
    $('#modal-title').textContent = `${st.name} — RA ${st.members.join(' / ')}`;
    $('#modal-unlock').hidden = !s?.locked;
    const problems = snap.problems;
    let pid = problems[0].id;

    const body = $('#modal-body');
    const draw = () => {
      const r = st.results[pid];
      const subs = st.submissions.filter((x) => x.pid === pid);
      body.innerHTML = `
        <div class="tabs">${problems
          .map((p, i) => {
            const rr = st.results[p.id];
            const mark = rr?.accepted ? ' ✔' : rr ? ' ✘' : '';
            return `<button data-pid="${p.id}" class="${p.id === pid ? 'active' : ''}">D${i + 1}${mark}</button>`;
          })
          .join('')}</div>
        <div class="cols">
          <div>
            <p><b>${esc(problems.find((p) => p.id === pid).title)}</b> —
              ${r ? (r.accepted ? '<span class="yes">Aceito</span>' : `<span class="no">${esc(r.last)}</span>`) + ` (${r.attempts} envio(s))` : '<span class="muted">sem envio</span>'}</p>
            <pre class="codebox">${esc(st.code[pid] || '(sem código)')}</pre>
            <h3>Envios</h3>
            <div class="list">${
              subs.length
                ? subs
                    .slice()
                    .reverse()
                    .map((x) => `<div>${fmtTime(x.at)} — <b class="${x.verdict === 'Aceito' ? 'yes' : 'no'}">${esc(x.verdict)}</b>${x.failedCase != null ? ` (caso ${x.failedCase + 1})` : ''}</div>`)
                    .join('')
                : '<span class="muted">nenhum</span>'
            }</div>
          </div>
          <div>
            <h3 style="margin-top:0">Eventos</h3>
            <div class="list">${st.events
              .slice()
              .reverse()
              .map((e) => `<div>${fmtTime(e.at)} <b>${esc(e.kind)}</b> ${esc(e.detail)}</div>`)
              .join('')}</div>
          </div>
        </div>`;
      body.querySelectorAll('.tabs button').forEach((b) =>
        b.addEventListener('click', () => {
          pid = b.dataset.pid;
          draw();
        }),
      );
    };
    draw();
    $('#modal').hidden = false;
  }

  function showSimilarity(pairs) {
    openRa = null;
    $('#modal-title').textContent = 'Similaridade de código (prova inteira)';
    $('#modal-unlock').hidden = true;
    $('#modal-body').innerHTML = `
      <p class="muted">Compara o código de todos os desafios de cada par de alunos (ignora comentários, espaços e nomes de variáveis).
      Desafios simples naturalmente ficam parecidos: use como pista, abra o código e confira. Só entram alunos com 3+ desafios escritos.</p>
      ${
        pairs.length
          ? `<table><thead><tr><th>Similaridade</th><th>Aluno A</th><th>Aluno B</th></tr></thead><tbody>${pairs
              .map(
                (p) => `<tr class="${p.sim >= 85 ? 'locked' : ''}"><td><b>${p.sim}%</b></td>
                <td>${esc(p.a)} <span class="muted">${esc(p.raA)}</span></td>
                <td>${esc(p.b)} <span class="muted">${esc(p.raB)}</span></td></tr>`,
              )
              .join('')}</tbody></table>`
          : '<p>Poucos dados ainda.</p>'
      }`;
    $('#modal').hidden = false;
  }

  connect();
})();
