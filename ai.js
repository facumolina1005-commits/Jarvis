// ai.js - modo CON IA. La app nunca guarda claves de IA: habla con tu servidor (Cloudflare Worker).

import * as S from './store.js';
import { AGENTS, funcSpecs } from './agents.js';
import { fmtDate, fmtDateTime, money, todayISO } from './util.js';

export async function callWorker(path, opts = {}) {
  const s = S.get().settings;
  if (!s.workerUrl || !s.token) throw new Error('Completá la URL del servidor y el token en Ajustes.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 35000);
  let r;
  try {
    r = await fetch(s.workerUrl.trim().replace(/\/+$/, '') + path, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.token.trim() }
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'El servidor tardó demasiado en responder.' : 'No hay conexión con el servidor.');
    err.offline = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await r.json(); } catch (e) { /* sin cuerpo */ }
  if (!r.ok) throw new Error((data && data.error) || `Error ${r.status} del servidor.`);
  return data;
}

function snapshot() {
  const db = S.get();
  const hoy = todayISO();
  const L = [];
  const t = db.tasks.filter(x => !x.hecha).slice(0, 20);
  L.push('Tareas pendientes: ' + (t.length ? t.map(x => x.titulo + (x.fecha ? ` (${x.fecha})` : '')).join('; ') : 'ninguna'));
  const r = db.reminders.filter(x => !x.avisado).slice(0, 10);
  L.push('Recordatorios pendientes: ' + (r.length ? r.map(x => `${x.texto} (${x.cuando})`).join('; ') : 'ninguno'));
  const g = db.goals.filter(x => !x.cumplido).slice(0, 10);
  L.push('Objetivos: ' + (g.length ? g.map(x => x.titulo).join('; ') : 'ninguno'));
  const e = db.exams.filter(x => x.fecha >= hoy).slice(0, 10);
  L.push('Exámenes próximos: ' + (e.length ? e.map(x => `${x.materia} (${x.fecha})`).join('; ') : 'ninguno'));
  const materias = {};
  for (const n of db.notes) materias[n.materia] = (materias[n.materia] || 0) + 1;
  L.push('Apuntes por materia: ' + (Object.keys(materias).length ? Object.entries(materias).map(([k, v]) => `${k} (${v})`).join('; ') : 'ninguno'));
  const w = db.workouts.slice(-8);
  L.push('Últimos entrenamientos: ' + (w.length ? w.map(x => `${x.fecha} ${x.ejercicio}${x.series && x.reps ? ' ' + x.series + 'x' + x.reps : ''}${x.peso ? ' ' + x.peso + 'kg' : ''}`).join('; ') : 'ninguno'));
  L.push('Investigaciones guardadas: ' + (db.research.length ? db.research.slice(-8).map(x => x.tema).join('; ') : 'ninguna'));
  const mes = hoy.slice(0, 7);
  const tx = db.transactions.filter(x => x.fecha.startsWith(mes));
  const ing = tx.filter(x => x.tipo === 'ingreso').reduce((a, x) => a + x.monto, 0);
  const gas = tx.filter(x => x.tipo === 'gasto').reduce((a, x) => a + x.monto, 0);
  L.push(`Finanzas del mes ${mes}: ingresos ${money(ing)}, gastos ${money(gas)}.`);
  const last = db.transactions.slice(-8);
  if (last.length) L.push('Últimos movimientos: ' + last.map(x => `${x.fecha} ${x.tipo} ${x.monto} (${x.categoria})`).join('; '));
  return L.join('\n').slice(0, 7000);
}

function buildSystem() {
  const s = S.get().settings;
  const now = new Date();
  const mem = S.get().memories.map(m => '- ' + m.texto).join('\n').slice(0, 4000);
  return `Sos ${s.name}, el asistente personal de ${s.userName || 'tu usuario'}. Personalidad: ${s.personality}
Fecha y hora actual: ${now.toLocaleString('es-AR')} (zona horaria ${Intl.DateTimeFormat().resolvedOptions().timeZone}). Hoy es ${todayISO()}.

Respondé SIEMPRE con un único objeto JSON, sin texto extra ni markdown:
{"reply":"...","agent":"jarvis|organizador|estudio|entrenamiento|investigacion|finanzas","actions":[{"fn":"nombre","args":{}}]}

Reglas:
- reply: lo que se dice en voz alta. Breve, natural, en español rioplatense. No leas listas largas: resumí.
- Para guardar o cambiar datos usá "actions" con las funciones de abajo. No inventes funciones, datos ni resultados.
- Para consultas usá los DATOS ACTUALES; no hace falta una acción.
- Si falta un dato necesario (fecha, hora, monto), preguntalo en "reply" y dejá "actions" vacío.
- Fechas "YYYY-MM-DD". Fecha y hora de recordatorios "YYYY-MM-DDTHH:MM" en hora local.
- Elegí en "agent" el agente que corresponde a la consulta.
- No guardes datos sensibles (contraseñas, tarjetas, documentos). Guardá recuerdos solo si el usuario lo pide.
- Para borrar usá las funciones de eliminar: la app pide confirmación al usuario.
- Si no sabés algo, decilo.

AGENTES Y FUNCIONES:
${funcSpecs()}

DATOS ACTUALES:
${snapshot()}

RECUERDOS DEL USUARIO:
${mem || '(ninguno)'}`;
}

function history(text, curId) {
  const out = [];
  const push = (role, content) => {
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + content;
    else out.push({ role, content });
  };
  for (const m of S.get().messages.filter(x => x.id !== curId).slice(-10)) {
    push(m.role, m.role === 'assistant' ? JSON.stringify({ reply: m.text }) : m.text);
  }
  push('user', text);
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function parseJSON(s) {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

export async function askAI(text, curId) {
  const s = S.get().settings;
  const data = await callWorker('/chat', {
    method: 'POST',
    body: JSON.stringify({ provider: s.provider, system: buildSystem(), messages: history(text, curId) })
  });
  const raw = String((data && data.text) || '');
  const obj = parseJSON(raw);
  if (!obj || typeof obj.reply !== 'string') return { reply: raw.trim() || 'No recibí respuesta.', agent: 'jarvis', actions: [] };
  return {
    reply: obj.reply,
    agent: AGENTS[obj.agent] ? obj.agent : 'jarvis',
    actions: Array.isArray(obj.actions) ? obj.actions.slice(0, 8) : []
  };
}
