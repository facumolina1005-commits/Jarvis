// app.js - interfaz de JARVIS

import * as S from './store.js';
import { AGENTS, agentInstructions, execute } from './agents.js';
import { localParse } from './parser.js';
import { askAI, callWorker } from './ai.js';
import * as V from './voice.js';
import { uid, esc, fmtDateTime } from './util.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let view = 'home';
let state = 'idle';
let recog = null;
let busy = false;
let openAgent = null;

/* ---------- diálogos y avisos ---------- */
function modal({ title, text = '', input = false, initial = '', ok = 'Aceptar', cancel = 'Cancelar' }) {
  return new Promise(resolve => {
    const box = $('#modal');
    const ta = $('#m-input');
    $('#m-title').textContent = title;
    $('#m-text').textContent = text;
    ta.hidden = !input;
    ta.value = initial;
    $('#m-ok').textContent = ok;
    $('#m-cancel').textContent = cancel;
    box.hidden = false;
    if (input) setTimeout(() => ta.focus(), 60);
    const done = v => {
      box.hidden = true;
      $('#m-ok').onclick = null;
      $('#m-cancel').onclick = null;
      resolve(v);
    };
    $('#m-ok').onclick = () => done(input ? ta.value.trim() : true);
    $('#m-cancel').onclick = () => done(input ? null : false);
  });
}
const confirmDlg = (text, ok = 'Confirmar') => modal({ title: 'Confirmación', text, ok });
const promptDlg = (title, initial = '') => modal({ title, input: true, initial, ok: 'Guardar' });

let bannerTimer = null;
function banner(text, autoHide = 0) {
  const b = $('#banner');
  const t = $('#banner-text');
  t.textContent = b.hidden ? text : t.textContent + '\n' + text;
  b.hidden = false;
  clearTimeout(bannerTimer);
  if (autoHide) bannerTimer = setTimeout(() => { b.hidden = true; }, autoHide);
}
$('#banner-close').onclick = () => { $('#banner').hidden = true; };

/* ---------- estado visual ---------- */
const LABELS = {
  idle: 'Tocá para hablar',
  listening: 'Escuchando… tocá para terminar',
  thinking: 'Procesando…',
  speaking: 'Hablando… tocá para interrumpir'
};
function setState(s) {
  state = s;
  $('#orb').className = s;
  $('#state-label').textContent = LABELS[s];
}

function agentName(id) {
  return (AGENTS[id] && AGENTS[id].name) || S.get().settings.name;
}
function showYou(t) { $('#you').textContent = t ? 'Vos: ' + t : ''; }
function showReply(t, agent) {
  $('#reply').textContent = t;
  $('#reply-agent').textContent = t && agent ? agentName(agent) : '';
  $('#reply-box').scrollTop = 0;
}

function updateStatus() {
  const s = S.get().settings;
  const off = !navigator.onLine;
  let t = s.mode === 'ai' ? (s.provider === 'gemini' ? 'IA · Gemini' : 'IA · Claude') : 'Sin IA';
  if (off) t += ' · sin conexión';
  const c = $('#chip');
  c.textContent = t;
  c.classList.toggle('on', s.mode === 'ai' && !off);
}

/* ---------- conversación ---------- */
function addMsg(role, text, agent = '') {
  const m = { id: uid(), role, text, agent, ts: Date.now() };
  S.get().messages.push(m);
  S.save();
  return m;
}

const spoken = t => String(t).replace(/[•\n]+/g, '. ').replace(/\s+/g, ' ').trim().slice(0, 600);

async function runActions(actions, source) {
  const out = [];
  for (const a of actions) out.push(await execute(a, { source, confirm: confirmDlg }));
  return out;
}

async function localFlow(text) {
  const p = localParse(text);
  if (!p) return { reply: 'No entendí ese comando. En modo sin IA entiendo órdenes concretas: escribí "ayuda" para ver ejemplos.', agent: 'jarvis' };
  if (!p.actions) return { reply: p.reply, agent: p.agent };
  const res = await runActions(p.actions, 'user');
  return { reply: res.join('\n'), agent: p.agent };
}

async function aiFlow(text, curId) {
  const r = await askAI(text, curId);
  const res = await runActions(r.actions, 'ai');
  return { reply: r.reply, extra: res.join('\n'), agent: r.agent };
}

function speakText(t) {
  if (!t) { setState('idle'); return; }
  V.speak(t, S.get().settings, { onStart: () => setState('speaking'), onEnd: () => setState('idle') });
}

async function handleInput(text) {
  text = String(text || '').trim();
  if (!text || busy) return;
  busy = true;
  V.stopSpeaking();
  const m = addMsg('user', text);
  showYou(text);
  showReply('', '');
  setState('thinking');
  let out;
  let fallback = false;
  try {
    if (S.get().settings.mode === 'ai') {
      try {
        out = await aiFlow(text, m.id);
      } catch (e) {
        if (e.offline) { fallback = true; out = await localFlow(text); } else throw e;
      }
    } else {
      out = await localFlow(text);
    }
  } catch (e) {
    out = { reply: e.message || 'Ocurrió un error.', agent: 'jarvis', error: true };
  }
  busy = false;
  const shown = out.reply + (out.extra ? '\n\n' + out.extra : '') + (fallback ? '\n\n(Sin conexión con la IA: respondí en modo local.)' : '');
  addMsg('assistant', shown, out.agent);
  showReply(shown, out.agent);
  refreshView();
  setState('idle');
  if (S.get().settings.speak && !out.error) speakText(spoken(out.reply));
}

/* ---------- voz ---------- */
function voiceError(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed')
    return 'Safari no tiene permiso para usar el micrófono o el reconocimiento de voz. Revisá Ajustes de iOS (Safari y Siri). Si instalaste JARVIS en el inicio y falla, abrilo desde Safari o usá el micrófono del teclado.';
  if (code === 'no-speech') return 'No te escuché. Probá de nuevo.';
  if (code === 'network') return 'El reconocimiento de voz necesita conexión a internet.';
  if (code === 'aborted') return '';
  return 'No pude usar el reconocimiento de voz. Escribí tu mensaje abajo o usá el micrófono del teclado.';
}

function startListening() {
  let errored = false;
  setState('listening');
  showYou('');
  try {
    recog = V.listen({
      onInterim: t => showYou(t),
      onError: code => { errored = true; setState('idle'); const m = voiceError(code); if (m) showReply(m, ''); },
      onEnd: t => {
        recog = null;
        if (errored) return;
        if (t) handleInput(t); else setState('idle');
      }
    });
  } catch (e) {
    recog = null;
    setState('idle');
    showReply(voiceError('start'), '');
  }
}

function onOrb() {
  V.unlock();
  if (state === 'speaking') { V.stopSpeaking(); setState('idle'); return; }
  if (state === 'listening') { if (recog) recog.stop(); return; }
  if (state === 'thinking') return;
  if (!V.canListen) {
    showReply('Este navegador no tiene reconocimiento de voz. Escribí abajo o usá el micrófono del teclado del iPhone.', '');
    $('#text-input').focus();
    return;
  }
  startListening();
}

/* ---------- navegación ---------- */
function show(v) {
  view = v;
  $$('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + v));
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  refreshView(true);
}

function refreshView(fresh) {
  if (view === 'history') renderHistory(fresh);
  else if (view === 'agents') renderAgents();
  else if (view === 'memory') renderMemory();
  else if (view === 'settings' && fresh) renderSettings();
}

/* ---------- historial ---------- */
function renderHistory(scroll) {
  const ms = S.get().messages;
  const el = $('#view-history');
  if (!ms.length) { el.innerHTML = '<h2>Historial</h2><p class="dim">Todavía no hay conversaciones.</p>'; return; }
  let html = '<div class="row between"><h2>Historial</h2><button class="ghost small" data-act="hist-clear">Borrar todo</button></div>';
  let day = '';
  for (const m of ms) {
    const d = new Date(m.ts).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (d !== day) { day = d; html += `<div class="day">${esc(d)}</div>`; }
    const t = new Date(m.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    html += `<div class="bubble ${m.role}"><div class="meta">${m.role === 'user' ? 'Vos' : esc(agentName(m.agent))} · ${t}</div>${esc(m.text)}</div>`;
  }
  el.innerHTML = html;
  if (scroll) el.scrollTop = el.scrollHeight;
}

/* ---------- agentes ---------- */
function renderAgents() {
  const el = $('#view-agents');
  const db = S.get();
  if (!openAgent) {
    el.innerHTML = '<h2>Agentes</h2><p class="dim">JARVIS elige el agente según lo que pidas. Tocá uno para ver sus instrucciones, funciones y datos.</p>' +
      Object.entries(AGENTS).map(([id, a]) => {
        const n = a.collections.reduce((s, c) => s + db[c.key].length, 0);
        return `<button class="card" data-act="agent-open" data-id="${id}"><span class="card-t">${esc(a.name)}</span><span class="card-d">${esc(a.desc)}</span><span class="card-m">${n} registro${n === 1 ? '' : 's'}</span></button>`;
      }).join('');
    return;
  }
  const a = AGENTS[openAgent];
  let html = `<button class="link" data-act="agent-back">‹ Agentes</button><h2>${esc(a.name)}</h2><p class="dim">${esc(a.desc)}</p>
  <h4>Instrucciones</h4>
  <textarea id="ag-instr" rows="5">${esc(agentInstructions(openAgent))}</textarea>
  <div class="row"><button class="primary" data-act="agent-save">Guardar</button><button class="ghost" data-act="agent-reset">Restaurar</button></div>
  <p class="dim small">Las instrucciones se envían a la IA en el modo con IA. En modo sin IA no tienen efecto.</p>
  <h4>Funciones</h4>`;
  html += Object.values(a.funcs).map(f => `<div class="fn"><code>${esc(f.sig)}</code><span>Sin IA: "${esc(f.ex)}"</span></div>`).join('');
  html += '<h4>Datos</h4>';
  for (const c of a.collections) {
    const items = db[c.key];
    html += `<h5>${esc(c.label)} (${items.length})</h5>`;
    if (!items.length) html += '<p class="dim small">Sin datos.</p>';
    html += items.slice(-50).reverse().map(it => `<div class="item"><span>${esc(c.line(it))}</span><button class="x" aria-label="Eliminar" data-act="item-del" data-key="${c.key}" data-id="${esc(it.id)}">Eliminar</button></div>`).join('');
  }
  el.innerHTML = html;
}

/* ---------- memoria ---------- */
function renderMemory() {
  const ms = S.get().memories;
  $('#view-memory').innerHTML = `<h2>Memoria</h2>
  <p class="dim">Lo que JARVIS recuerda de vos. Solo se guarda lo que pedís (por ejemplo: "recordá que..."). Podés editarlo o borrarlo.</p>
  <div class="row"><input id="mem-new" placeholder="Agregar un recuerdo" autocomplete="off"><button class="primary" data-act="mem-add">Agregar</button></div>` +
    (ms.length ? ms.slice().reverse().map(m => `<div class="item"><span>${esc(m.texto)}<small class="dim"> · ${esc(fmtDateTime(m.creado))}</small></span><span class="btns"><button class="x" data-act="mem-edit" data-id="${esc(m.id)}">Editar</button><button class="x" data-act="mem-del" data-id="${esc(m.id)}">Eliminar</button></span></div>`).join('')
      : '<p class="dim">Todavía no hay recuerdos.</p>');
}

/* ---------- ajustes ---------- */
function renderSettings() {
  const s = S.get().settings;
  const sel = (a, b) => (a === b ? ' selected' : '');
  $('#view-settings').innerHTML = `<h2>Ajustes</h2>
  <h4>Identidad</h4>
  <label>Nombre del asistente<input data-set="name" value="${esc(s.name)}"></label>
  <label>Tu nombre<input data-set="userName" value="${esc(s.userName)}" placeholder="Cómo querés que te llame"></label>
  <label>Personalidad (la usa el modo con IA)<textarea data-set="personality" rows="4">${esc(s.personality)}</textarea></label>
  <h4>Voz</h4>
  <label class="check"><input type="checkbox" data-set="speak"${s.speak ? ' checked' : ''}> Responder en voz alta</label>
  <label>Voz<select data-set="voiceURI" id="voice-sel"><option value="">Automática (español)</option></select></label>
  <label>Velocidad: <span id="rate-v">${s.rate}</span><input type="range" min="0.6" max="1.4" step="0.05" data-set="rate" value="${s.rate}"></label>
  <label>Tono: <span id="pitch-v">${s.pitch}</span><input type="range" min="0.6" max="1.4" step="0.05" data-set="pitch" value="${s.pitch}"></label>
  <button class="ghost" data-act="voice-test">Probar voz</button>
  <p class="dim small">iOS no permite elegir "voz masculina" por género: elegí de la lista. Para voces más naturales, descargalas en Ajustes de iOS > Accesibilidad > Contenido leído > Voces.</p>
  <h4>Inteligencia artificial</h4>
  <label>Modo<select data-set="mode"><option value="local"${sel(s.mode, 'local')}>Sin IA (funciona sin internet)</option><option value="ai"${sel(s.mode, 'ai')}>Con IA</option></select></label>
  <label>Proveedor<select data-set="provider"><option value="anthropic"${sel(s.provider, 'anthropic')}>Claude (Anthropic)</option><option value="gemini"${sel(s.provider, 'gemini')}>Gemini (Google)</option></select></label>
  <label>URL de tu servidor (Cloudflare Worker)<input data-set="workerUrl" type="url" value="${esc(s.workerUrl)}" placeholder="https://jarvis.tuusuario.workers.dev" autocapitalize="off" autocorrect="off"></label>
  <label>Token de acceso<input data-set="token" type="password" value="${esc(s.token)}" autocapitalize="off" autocorrect="off"></label>
  <button class="ghost" data-act="conn-test">Probar conexión</button>
  <p class="dim small">En modo con IA, tu mensaje y un resumen de tus datos se envían al proveedor elegido. Las claves de la IA viven solo en tu servidor.</p>
  <h4>Datos</h4>
  <div class="row wrap"><button class="ghost" data-act="cloud-up">Subir a la nube</button><button class="ghost" data-act="cloud-down">Bajar de la nube</button></div>
  <div class="row wrap"><button class="ghost" data-act="bk-copy">Copiar copia de seguridad</button><button class="ghost" data-act="bk-restore">Restaurar copia</button></div>
  <button class="danger" data-act="wipe">Borrar todos mis datos</button>
  <p class="dim small">Los datos viven en este iPhone. La nube (Supabase) es opcional y la manejás vos.</p>`;
  V.getVoices().then(vs => {
    const el = $('#voice-sel');
    if (!el) return;
    const es = vs.filter(v => /^es/i.test(v.lang));
    el.innerHTML = '<option value="">Automática (español)</option>' +
      (es.length ? es : vs).map(v => `<option value="${esc(v.voiceURI)}"${v.voiceURI === s.voiceURI ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  });
}

function onSettingChange(e) {
  const el = e.target;
  const k = el.dataset && el.dataset.set;
  if (!k) return;
  const s = S.get().settings;
  if (el.type === 'checkbox') s[k] = el.checked;
  else if (el.type === 'range') { s[k] = Number(el.value); const l = $(k === 'rate' ? '#rate-v' : '#pitch-v'); if (l) l.textContent = el.value; }
  else s[k] = el.value;
  S.save();
  if (k === 'name') $('#brand').textContent = s.name || 'JARVIS';
  if (k === 'mode' || k === 'provider') updateStatus();
}

/* ---------- acciones de los botones ---------- */
function afterDataReplace() {
  $('#brand').textContent = S.get().settings.name || 'JARVIS';
  updateStatus();
  openAgent = null;
  refreshView(true);
}

async function onAct(act, el) {
  const db = S.get();
  switch (act) {
    case 'agent-open': openAgent = el.dataset.id; renderAgents(); $('#view-agents').scrollTop = 0; break;
    case 'agent-back': openAgent = null; renderAgents(); break;
    case 'agent-save': db.agentInstructions[openAgent] = $('#ag-instr').value.trim(); S.save(); banner('Instrucciones guardadas.', 2500); break;
    case 'agent-reset': delete db.agentInstructions[openAgent]; S.save(); renderAgents(); break;
    case 'item-del': {
      if (!(await confirmDlg('¿Eliminar este dato? No se puede deshacer.', 'Eliminar'))) break;
      db[el.dataset.key] = db[el.dataset.key].filter(x => x.id !== el.dataset.id);
      S.save();
      renderAgents();
      break;
    }
    case 'mem-add': {
      const i = $('#mem-new');
      const t = i.value.trim();
      if (!t) break;
      if (/(contrase[nñ]a|password|clave|tarjeta|cvv|\bdni\b|pasaporte|\b\d{13,19}\b)/i.test(t) &&
          !(await confirmDlg('Esto parece información sensible (claves, tarjetas o documentos). ¿Querés guardarlo igual?', 'Guardar igual'))) break;
      db.memories.push({ id: uid(), texto: t, creado: new Date().toISOString() });
      S.save();
      renderMemory();
      break;
    }
    case 'mem-edit': {
      const m = db.memories.find(x => x.id === el.dataset.id);
      if (!m) break;
      const t = await promptDlg('Editar recuerdo', m.texto);
      if (t) { m.texto = t; S.save(); renderMemory(); }
      break;
    }
    case 'mem-del':
      if (!(await confirmDlg('¿Eliminar este recuerdo?', 'Eliminar'))) break;
      db.memories = db.memories.filter(x => x.id !== el.dataset.id);
      S.save();
      renderMemory();
      break;
    case 'hist-clear':
      if (!(await confirmDlg('¿Borrar todo el historial de conversaciones?', 'Borrar'))) break;
      db.messages = [];
      S.save();
      renderHistory();
      break;
    case 'voice-test':
      V.unlock();
      speakText(`Hola${db.settings.userName ? ' ' + db.settings.userName : ''}, soy ${db.settings.name}. Esta es mi voz.`);
      break;
    case 'conn-test':
      try {
        const r = await callWorker('/ping');
        banner(`Conexión correcta. Claude: ${r.anthropic ? 'listo' : 'sin clave'}. Gemini: ${r.gemini ? 'listo' : 'sin clave'}. Nube: ${r.supabase ? 'lista' : 'sin configurar'}.`, 6000);
      } catch (e) { banner(e.message, 6000); }
      break;
    case 'cloud-up':
      if (!(await confirmDlg('Esto reemplaza la copia que haya en la nube con los datos de este iPhone.', 'Subir'))) break;
      try { await callWorker('/state', { method: 'PUT', body: JSON.stringify({ data: JSON.parse(S.exportText()) }) }); banner('Copia subida a la nube.', 3000); }
      catch (e) { banner(e.message, 6000); }
      break;
    case 'cloud-down':
      if (!(await confirmDlg('Esto reemplaza los datos de este iPhone con la copia de la nube.', 'Bajar'))) break;
      try {
        const r = await callWorker('/state');
        if (!r.data) { banner('No hay copia en la nube todavía.', 4000); break; }
        S.importText(JSON.stringify(r.data));
        afterDataReplace();
        banner('Datos restaurados desde la nube.', 3000);
      } catch (e) { banner(e.message, 6000); }
      break;
    case 'bk-copy':
      try { await navigator.clipboard.writeText(S.exportText()); banner('Copia de seguridad copiada. Pegala en Notas para guardarla.', 4000); }
      catch (e) { banner('No pude copiar al portapapeles.', 4000); }
      break;
    case 'bk-restore': {
      const t = await promptDlg('Pegá la copia de seguridad');
      if (!t) break;
      try { S.importText(t); afterDataReplace(); banner('Copia restaurada.', 3000); }
      catch (e) { banner('La copia no es válida.', 4000); }
      break;
    }
    case 'wipe':
      if (!(await confirmDlg('Se borrarán todas tus tareas, memorias, historial y ajustes de este iPhone. No se puede deshacer.', 'Borrar todo'))) break;
      S.wipe();
      location.reload();
      break;
  }
}

/* ---------- recordatorios ---------- */
function checkReminders() {
  const now = new Date();
  let fired = false;
  for (const r of S.get().reminders) {
    if (!r.avisado && new Date(r.cuando) <= now) {
      r.avisado = true;
      fired = true;
      banner('Recordatorio: ' + r.texto);
      if (S.get().settings.speak && state === 'idle') speakText('Recordatorio: ' + r.texto);
    }
  }
  if (fired) { S.save(); refreshView(); }
}

/* ---------- arranque ---------- */
function boot() {
  $('#brand').textContent = S.get().settings.name || 'JARVIS';
  updateStatus();
  setState('idle');
  const ms = S.get().messages;
  if (!ms.length) showReply('Hola. Tocá el círculo para hablar o escribime abajo. Escribí "ayuda" para ver qué puedo hacer sin IA.', '');
  else {
    const last = ms.slice().reverse().find(m => m.role === 'assistant');
    if (last) showReply(last.text, last.agent);
  }

  $('#orb').addEventListener('click', onOrb);
  $('#text-form').addEventListener('submit', e => {
    e.preventDefault();
    V.unlock();
    const i = $('#text-input');
    const t = i.value;
    i.value = '';
    handleInput(t);
  });
  $$('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (el) onAct(el.dataset.act, el);
  });
  document.addEventListener('input', onSettingChange);
  document.addEventListener('change', onSettingChange);
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  checkReminders();
  setInterval(checkReminders, 15000);
}

boot();
