// util.js - funciones de ayuda compartidas (fechas, dinero, texto)

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const norm = s =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => isoDate(new Date());
export const localISO = d => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseMoney(s) {
  let t = String(s ?? '').replace(/[^\d.,]/g, '').replace(/[.,]+$/, '');
  if (!t) return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  return parseFloat(t);
}

export const money = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });

// Busca una fecha en el texto ("hoy", "mañana", "pasado mañana", "15/11", "15/11/2026").
// Devuelve la fecha (YYYY-MM-DD o null) y el texto sin la expresión de fecha.
export function extractDate(text) {
  const n = norm(text);
  const now = new Date();
  const cut = m => (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  let m;
  if ((m = n.match(/\b(para\s+|el\s+)?pasado\s+manana\b/))) return { fecha: isoDate(addDays(now, 2)), texto: cut(m) };
  if ((m = n.match(/\b(para\s+)?manana\b/))) return { fecha: isoDate(addDays(now, 1)), texto: cut(m) };
  if ((m = n.match(/\b(para\s+)?hoy\b/))) return { fecha: isoDate(now), texto: cut(m) };
  if ((m = n.match(/\b(?:(?:para|hasta)\s+)?(?:el\s+)?(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/))) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : now.getFullYear();
    if (y < 100) y += 2000;
    let dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return { fecha: null, texto: text.trim() };
    if (!m[3] && dt < new Date(now.getFullYear(), now.getMonth(), now.getDate())) dt = new Date(y + 1, mo - 1, d);
    return { fecha: isoDate(dt), texto: cut(m) };
  }
  return { fecha: null, texto: text.trim() };
}

// Interpreta cuándo: "en 30 minutos", "mañana a las 8", "a las 20:30", "15/11 a las 9".
export function parseWhen(text) {
  const now = new Date();
  let rest = text;
  const cutRe = re => {
    const m = norm(rest).match(re);
    if (!m) return null;
    rest = (rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return m;
  };
  const clean = s => s.replace(/^(de|que|a|para)\s+/i, '').replace(/\s+(a|para|en|el|de)$/i, '').trim();

  let m = cutRe(/\ben\s+(\d+)\s*(minutos?|min|horas?|hs|h)\b/);
  if (m) {
    const k = +m[1];
    const mins = m[2].startsWith('min') ? k : k * 60;
    return { cuando: new Date(now.getTime() + mins * 60000), texto: clean(rest) };
  }
  const pm = cutRe(/\bde\s+la\s+(manana|tarde|noche)\b/);
  const period = pm ? pm[1] : '';
  const dd = extractDate(rest);
  const day = dd.fecha;
  rest = dd.texto;
  m = cutRe(/\ba\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|hs)?\b/);
  let h = null, mi = 0;
  if (m) {
    h = +m[1];
    mi = +(m[2] || 0);
    const suf = m[3] || '';
    if ((suf === 'pm' || period === 'tarde' || period === 'noche') && h < 12) h += 12;
    if ((suf === 'am' || period === 'manana') && h === 12) h = 0;
  }
  if (h === null && !day) return { cuando: null, texto: clean(rest) };
  if (h === null) h = 9;
  if (h > 23 || mi > 59) return { cuando: null, texto: clean(rest) };
  let when;
  if (day) {
    when = new Date(day + 'T00:00:00');
    when.setHours(h, mi, 0, 0);
  } else {
    when = new Date(now);
    when.setHours(h, mi, 0, 0);
    if (when <= now) when = addDays(when, 1);
  }
  return { cuando: when, texto: clean(rest) };
}
