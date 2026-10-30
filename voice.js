// voice.js - reconocimiento y síntesis de voz con las funciones del navegador.
// En iPhone: la síntesis (hablar) funciona en Safari y en la app instalada.
// El reconocimiento (escuchar) puede no estar disponible o fallar en la app instalada: hay plan B (teclado).

const synth = window.speechSynthesis;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let token = 0;

export const canSpeak = !!synth;
export const canListen = !!SR;

export function getVoices() {
  return new Promise(resolve => {
    if (!synth) return resolve([]);
    const v = synth.getVoices();
    if (v.length) return resolve(v);
    const t = setTimeout(() => resolve(synth.getVoices()), 1200);
    synth.addEventListener('voiceschanged', () => { clearTimeout(t); resolve(synth.getVoices()); }, { once: true });
  });
}

// iOS solo deja hablar después de un toque del usuario: "desbloquea" la voz con un toque.
export function unlock() {
  if (!synth) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  } catch (e) { /* nada */ }
}

function chunks(text) {
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 180 && cur) { out.push(cur.trim()); cur = p; } else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function stopSpeaking() {
  token++;
  if (synth) { try { synth.cancel(); } catch (e) { /* nada */ } }
}

export async function speak(text, s, cb = {}) {
  if (!synth || !text) { if (cb.onEnd) cb.onEnd(); return; }
  stopSpeaking();
  const my = ++token;
  const voices = await getVoices();
  const voice = voices.find(v => v.voiceURI === s.voiceURI)
    || voices.find(v => /^es[-_]AR/i.test(v.lang))
    || voices.find(v => /^es/i.test(v.lang));
  const list = chunks(text);
  let i = 0;
  const next = () => {
    if (my !== token) return;
    if (i >= list.length) { if (cb.onEnd) cb.onEnd(); return; }
    const u = new SpeechSynthesisUtterance(list[i++]);
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : 'es-AR';
    u.rate = Number(s.rate) || 1;
    u.pitch = Number(s.pitch) || 1;
    if (i === 1) u.onstart = () => { if (my === token && cb.onStart) cb.onStart(); };
    u.onend = next;
    u.onerror = () => { if (my === token && cb.onEnd) cb.onEnd(); };
    synth.speak(u);
  };
  next();
}

export function listen({ onInterim, onError, onEnd }) {
  const r = new SR();
  r.lang = 'es-AR';
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let finalText = '';
  r.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t; else interim += t;
    }
    if (onInterim) onInterim((finalText + interim).trim());
  };
  r.onerror = e => { if (onError) onError(e.error); };
  r.onend = () => { if (onEnd) onEnd(finalText.trim()); };
  r.start();
  return r;
}
