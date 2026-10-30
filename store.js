// store.js - datos de JARVIS guardados en este iPhone (localStorage)

const KEY = 'jarvis.v1';

const defaults = () => ({
  settings: {
    name: 'JARVIS',
    userName: '',
    personality: 'Inteligente, profesional, natural y directo. Amable, con algo de humor sutil. Habla en español rioplatense, sin sonar robótico.',
    voiceURI: '',
    rate: 1,
    pitch: 0.9,
    speak: true,
    mode: 'local',
    provider: 'anthropic',
    workerUrl: '',
    token: ''
  },
  agentInstructions: {},
  memories: [],
  messages: [],
  tasks: [],
  reminders: [],
  goals: [],
  notes: [],
  exams: [],
  workouts: [],
  research: [],
  transactions: []
});

function merge(raw) {
  const base = defaults();
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(base)) {
      if (raw[k] === undefined || raw[k] === null) continue;
      if (k === 'settings' || k === 'agentInstructions') base[k] = { ...base[k], ...raw[k] };
      else if (Array.isArray(base[k]) && Array.isArray(raw[k])) base[k] = raw[k];
    }
  }
  return base;
}

function load() {
  try {
    return merge(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch (e) {
    console.warn('No se pudieron leer los datos', e);
    return defaults();
  }
}

let db = load();

export const get = () => db;

export function save() {
  if (db.messages.length > 500) db.messages = db.messages.slice(-500);
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.warn('No se pudo guardar', e);
  }
}

// Copia de seguridad: no incluye el token secreto.
export function exportText() {
  const copy = JSON.parse(JSON.stringify(db));
  copy.settings.token = '';
  return JSON.stringify(copy);
}

// Reemplaza los datos con una copia; conserva la conexión (URL y token) de este dispositivo.
export function importText(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) throw new Error('La copia no tiene el formato de JARVIS.');
  const next = merge(raw);
  next.settings.token = db.settings.token;
  next.settings.workerUrl = db.settings.workerUrl;
  db = next;
  save();
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch (e) { /* nada */ }
  db = defaults();
}
