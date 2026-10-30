// parser.js - modo SIN IA: entiende órdenes concretas con reglas (sin API)

import * as S from './store.js';
import { norm, extractDate, parseWhen, parseMoney, localISO } from './util.js';

export const AYUDA = `Modo sin IA: entiendo órdenes como estas.
• agregar tarea comprar pan para mañana
• mis tareas / completar tarea pan
• recordame llamar a Juan mañana a las 8
• agenda
• gasté 3500 en comida / ingresé 200000 sueldo / balance
• entrené press banca 3x10 60kg / progreso press banca
• apunte de historia: la revolución fue en 1810
• examen de matemática 15/11 / plan de estudio matemática
• objetivo: leer 12 libros / mis objetivos
• recordá que mi café favorito es el cortado / mis recuerdos
• guardar investigación energía solar: texto
Para conversar, investigar o resumir activá el modo con IA en Ajustes.`;

const act = (agent, fn, args = {}) => ({ agent, actions: [{ fn, args }] });

function finanza(tipo, r) {
  const fn = tipo === 'gasto' ? 'gasto_registrar' : 'ingreso_registrar';
  const mm = r.match(/\$?\s*(\d[\d.,]*)\s*(.*)$/);
  if (!mm) return { agent: 'finanzas', reply: `Decime el monto. Ejemplo: "${tipo === 'gasto' ? 'gasté 3500 en comida' : 'ingresé 200000 sueldo'}".` };
  let cat = mm[2].trim();
  for (let i = 0; i < 3; i++) cat = cat.replace(/^(pesos|de|en|por|para)\s+/i, '').trim();
  return act('finanzas', fn, { monto: parseMoney(mm[1]), categoria: cat });
}

function entreno(r) {
  const w = r.match(/^(.+?)\s+(\d+)\s*[x×]\s*(\d+)(?:\s*(?:con|a|de)?\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kilos?))?/i);
  if (!w) return { agent: 'entrenamiento', reply: 'Formato: "entrené press banca 3x10 60kg" (ejercicio, series x repeticiones, peso opcional).' };
  return act('entrenamiento', 'entreno_registrar', {
    ejercicio: w[1].trim(), series: +w[2], reps: +w[3], peso: w[4] ? parseFloat(w[4].replace(',', '.')) : null
  });
}

export function localParse(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const n = norm(t);
  let m;
  const rest = () => t.slice(m[0].length).trim();

  if ((m = n.match(/^(ayuda|help|comandos|que podes hacer|que sabes hacer)\b/))) return { agent: 'jarvis', reply: AYUDA };
  if ((m = n.match(/^(hola|buenas|hey|buen dia|buenos dias|buenas tardes|buenas noches)\b/))) {
    const s = S.get().settings;
    return { agent: 'jarvis', reply: `Hola${s.userName ? ', ' + s.userName : ''}. ¿En qué te ayudo?` };
  }

  // Organizador
  if ((m = n.match(/^(agrega|agregar|anota|anotar|nueva|crea|crear|suma|sumar)\s+(una\s+)?tarea\s*:?\s*/))) {
    const { fecha, texto } = extractDate(rest());
    if (!texto) return { agent: 'organizador', reply: '¿Qué tarea querés agregar?' };
    return act('organizador', 'tarea_agregar', { titulo: texto, fecha: fecha || '' });
  }
  if (/^(mis\s+)?(tareas|pendientes)\b/.test(n) || /^que\s+tengo\s+pendiente/.test(n)) return act('organizador', 'tarea_listar');
  if ((m = n.match(/^(completa|completar|termine|hice|listo)\s+(la\s+)?tarea\s*:?\s*/))) return act('organizador', 'tarea_completar', { texto: rest() });
  if ((m = n.match(/^(elimina|eliminar|borra|borrar|quita|quitar)\s+(la\s+)?tarea\s*:?\s*/))) return act('organizador', 'tarea_eliminar', { texto: rest() });
  if ((m = n.match(/^(recordame|recuerdame|avisame|recordarme)\s+(de\s+|que\s+)?/))) {
    const { cuando, texto } = parseWhen(rest());
    if (!texto) return { agent: 'organizador', reply: '¿Qué querés que te recuerde?' };
    if (!cuando) return { agent: 'organizador', reply: '¿Cuándo? Por ejemplo: "recordame llamar a Juan mañana a las 8" o "recordame tomar agua en 30 minutos".' };
    return act('organizador', 'recordatorio_crear', { texto, cuando: localISO(cuando) });
  }
  if (/^(mis\s+)?recordatorios\b/.test(n)) return act('organizador', 'recordatorio_listar');
  if (/^(mis\s+)?objetivos\b/.test(n)) return act('organizador', 'objetivo_listar');
  if ((m = n.match(/^(cumpli|complete|logre)\s+(el\s+)?objetivo\s*:?\s*/))) return act('organizador', 'objetivo_completar', { texto: rest() });
  if ((m = n.match(/^(nuevo\s+)?objetivo\s*:?\s*/)) && rest()) return act('organizador', 'objetivo_agregar', { titulo: rest() });
  if (/^(mi\s+)?agenda\b/.test(n) || /^que\s+tengo\s+(hoy|manana|esta\s+semana|para\s+hoy)/.test(n)) return act('organizador', 'agenda_consultar');

  // Memoria
  if (/^(que\s+recordas|que\s+sabes\s+de\s+mi|mis\s+recuerdos|memoria)\b/.test(n)) return act('jarvis', 'memorias_listar');
  if ((m = n.match(/^(olvida|olvidate|olvidar|borra\s+el\s+recuerdo)\b\s*(que\s+|de\s+)?/))) return act('jarvis', 'olvidar', { texto: rest() });
  if ((m = n.match(/^(recorda|recuerda|acordate|guarda\s+en\s+(tu\s+)?memoria)\b\s*(que\s+|:)?\s*/))) {
    const r = rest();
    if (!r) return { agent: 'jarvis', reply: '¿Qué querés que recuerde?' };
    return act('jarvis', 'recordar', { texto: r });
  }

  // Estudio
  if ((m = n.match(/^(guarda\s+|guardar\s+|nuevo\s+)?(apunte|nota)\s+(de|sobre)\s+/))) {
    const r = rest();
    const i = r.indexOf(':');
    if (i < 1) return { agent: 'estudio', reply: 'Usá este formato: "apunte de historia: texto del apunte".' };
    return act('estudio', 'apunte_guardar', { materia: r.slice(0, i).trim(), texto: r.slice(i + 1).trim() });
  }
  if ((m = n.match(/^(mis\s+)?apuntes\b(\s+(de|sobre)\s+)?/))) return act('estudio', 'apunte_listar', { materia: rest() });
  if ((m = n.match(/^(registra\s+|registrar\s+|nuevo\s+)?examen\s+(de\s+)?/))) {
    const { fecha, texto } = extractDate(rest());
    if (!texto) return { agent: 'estudio', reply: '¿De qué materia es el examen?' };
    if (!fecha) return { agent: 'estudio', reply: '¿Para qué fecha? Ejemplo: "examen de matemática 15/11".' };
    return act('estudio', 'examen_registrar', { materia: texto, fecha });
  }
  if (/^(mis\s+)?examenes\b/.test(n)) return act('estudio', 'examen_listar');
  if ((m = n.match(/^plan\s+de\s+estudio\s*(para\s+|de\s+)?/))) {
    const { fecha, texto } = extractDate(rest());
    return act('estudio', 'plan_estudio', { materia: texto, fecha: fecha || '' });
  }

  // Entrenamiento
  if ((m = n.match(/^(progreso|evolucion)\s+(?:(?:de|en)\s+)?/))) return act('entrenamiento', 'entreno_progreso', { ejercicio: rest() });
  if ((m = n.match(/^(mis\s+)?(entrenamientos|rutinas|ejercicios)\b\s*(de\s+)?/))) return act('entrenamiento', 'entreno_listar', { ejercicio: rest() });
  if ((m = n.match(/^(entrene|entrenamiento|registra\s+(un\s+)?(entrenamiento|ejercicio)|ejercicio)\b\s*:?\s*/))) return entreno(rest());

  // Finanzas
  if ((m = n.match(/^(gaste|gasto|pague|compre)\s+/))) return finanza('gasto', rest());
  if ((m = n.match(/^(ingrese|ingreso|cobre|cobro|me\s+pagaron|me\s+depositaron)\s+/))) return finanza('ingreso', rest());
  if (/^(balance|estadisticas|resumen|cuanto\s+gaste)\b/.test(n)) return act('finanzas', 'finanzas_balance');
  if (/^(mis\s+)?(gastos|movimientos|finanzas)\b/.test(n)) return act('finanzas', 'finanzas_listar');

  // Investigación
  if ((m = n.match(/^(guarda|guardar)\s+investigacion\s+(sobre\s+|de\s+)?/))) {
    const r = rest();
    const i = r.indexOf(':');
    if (i < 1) return { agent: 'investigacion', reply: 'Usá este formato: "guardar investigación energía solar: texto".' };
    return act('investigacion', 'investigacion_guardar', { tema: r.slice(0, i).trim(), texto: r.slice(i + 1).trim() });
  }
  if (/^(mis\s+)?investigaciones\b/.test(n)) return act('investigacion', 'investigacion_listar');
  if (/^(investiga|investigar|compara|comparar|resumi|resumir|analiza|analizar)\b/.test(n))
    return { agent: 'investigacion', reply: 'Investigar, comparar y resumir necesita el modo con IA (Ajustes). En modo sin IA podés guardar tus propias investigaciones: "guardar investigación TEMA: texto".' };

  return null;
}
