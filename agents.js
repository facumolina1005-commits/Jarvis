// agents.js - agentes especializados. Cada agente tiene instrucciones, funciones y datos propios.
// Las funciones son código tradicional: funcionan sin IA y sin internet.

import * as S from './store.js';
import { uid, norm, fmtDate, fmtDateTime, money, parseMoney, isoDate, todayISO, addDays, localISO } from './util.js';

const db = () => S.get();
const okDate = f => (/^\d{4}-\d{2}-\d{2}$/.test(String(f || '')) ? String(f) : '');
const daysUntil = f => Math.round((new Date(f + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
const lines = (arr, empty) => (arr.length ? arr.join('\n') : empty);
const toNum = v => (typeof v === 'number' ? v : parseMoney(String(v ?? '')));

function pick(list, key, texto, what) {
  const t = String(texto || '').trim();
  if (!t) return { msg: `Decime cuál ${what}.` };
  const q = norm(t);
  const f = list.filter(x => norm(x[key]).includes(q));
  if (f.length === 0) return { msg: `No encontré ninguna ${what} que coincida con "${t}".` };
  if (f.length > 1) {
    const exact = f.find(x => norm(x[key]) === q);
    if (exact) return { item: exact };
    return { msg: `Hay varias coincidencias:\n${f.slice(0, 5).map(x => '• ' + x[key]).join('\n')}\nSé más específico.` };
  }
  return { item: f[0] };
}

/* ---------------- ORGANIZADOR ---------------- */
const organizador = {
  tarea_agregar: {
    sig: 'tarea_agregar(titulo, fecha?="YYYY-MM-DD")',
    ex: 'agregar tarea comprar pan para mañana',
    run({ titulo, fecha }) {
      titulo = String(titulo || '').trim();
      if (!titulo) return 'Falta el título de la tarea.';
      fecha = okDate(fecha);
      db().tasks.push({ id: uid(), titulo, fecha, hecha: false, creada: new Date().toISOString() });
      S.save();
      return `Tarea creada: ${titulo}${fecha ? ' (' + fmtDate(fecha) + ')' : ''}.`;
    }
  },
  tarea_listar: {
    sig: 'tarea_listar()',
    ex: 'mis tareas',
    run() {
      const p = db().tasks.filter(t => !t.hecha).sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999'));
      return lines(p.map(t => `• ${t.titulo}${t.fecha ? ' (' + fmtDate(t.fecha) + ')' : ''}`), 'No tenés tareas pendientes.');
    }
  },
  tarea_completar: {
    sig: 'tarea_completar(texto)',
    ex: 'completar tarea comprar pan',
    run({ texto }) {
      const r = pick(db().tasks.filter(t => !t.hecha), 'titulo', texto, 'tarea');
      if (!r.item) return r.msg;
      r.item.hecha = true;
      S.save();
      return `Tarea completada: ${r.item.titulo}.`;
    }
  },
  tarea_eliminar: {
    sig: 'tarea_eliminar(texto)  [pide confirmación]',
    ex: 'eliminar tarea comprar pan',
    run({ texto }) {
      const r = pick(db().tasks, 'titulo', texto, 'tarea');
      if (!r.item) return r.msg;
      db().tasks = db().tasks.filter(t => t.id !== r.item.id);
      S.save();
      return `Tarea eliminada: ${r.item.titulo}.`;
    }
  },
  recordatorio_crear: {
    sig: 'recordatorio_crear(texto, cuando="YYYY-MM-DDTHH:MM")',
    ex: 'recordame llamar a Juan mañana a las 8',
    run({ texto, cuando }) {
      texto = String(texto || '').trim();
      const d = new Date(cuando);
      if (!texto) return 'Falta el texto del recordatorio.';
      if (isNaN(d)) return 'No entendí la fecha y hora del recordatorio.';
      db().reminders.push({ id: uid(), texto, cuando: localISO(d), avisado: false });
      S.save();
      return `Recordatorio creado: ${texto} (${fmtDateTime(localISO(d))}). Te aviso mientras JARVIS esté abierto.`;
    }
  },
  recordatorio_listar: {
    sig: 'recordatorio_listar()',
    ex: 'mis recordatorios',
    run() {
      const p = db().reminders.filter(r => !r.avisado).sort((a, b) => a.cuando.localeCompare(b.cuando));
      return lines(p.map(r => `• ${r.texto} (${fmtDateTime(r.cuando)})`), 'No tenés recordatorios pendientes.');
    }
  },
  objetivo_agregar: {
    sig: 'objetivo_agregar(titulo)',
    ex: 'objetivo: leer 12 libros',
    run({ titulo }) {
      titulo = String(titulo || '').trim();
      if (!titulo) return 'Falta el objetivo.';
      db().goals.push({ id: uid(), titulo, cumplido: false, creado: new Date().toISOString() });
      S.save();
      return `Objetivo agregado: ${titulo}.`;
    }
  },
  objetivo_listar: {
    sig: 'objetivo_listar()',
    ex: 'mis objetivos',
    run() {
      return lines(db().goals.map(g => `• ${g.cumplido ? '[cumplido] ' : ''}${g.titulo}`), 'Todavía no cargaste objetivos.');
    }
  },
  objetivo_completar: {
    sig: 'objetivo_completar(texto)',
    ex: 'cumplí objetivo leer',
    run({ texto }) {
      const r = pick(db().goals.filter(g => !g.cumplido), 'titulo', texto, 'objetivo');
      if (!r.item) return r.msg;
      r.item.cumplido = true;
      S.save();
      return `Objetivo cumplido: ${r.item.titulo}.`;
    }
  },
  agenda_consultar: {
    sig: 'agenda_consultar()',
    ex: 'agenda',
    run() {
      const hoy = todayISO();
      const lim = isoDate(addDays(new Date(), 7));
      const out = [];
      for (const t of db().tasks) if (!t.hecha && t.fecha && t.fecha <= lim) out.push({ f: t.fecha, txt: `${t.fecha < hoy ? '[vencida] ' : ''}Tarea: ${t.titulo}` });
      for (const r of db().reminders) if (!r.avisado && r.cuando.slice(0, 10) <= lim) out.push({ f: r.cuando, txt: `Recordatorio: ${r.texto} (${fmtDateTime(r.cuando)})` });
      for (const e of db().exams) if (e.fecha >= hoy && e.fecha <= lim) out.push({ f: e.fecha, txt: `Examen: ${e.materia}` });
      out.sort((a, b) => a.f.localeCompare(b.f));
      return lines(out.map(o => `• ${fmtDate(o.f)} - ${o.txt}`), 'No tenés nada en la agenda de los próximos 7 días.');
    }
  }
};

/* ---------------- ESTUDIO ---------------- */
const estudio = {
  apunte_guardar: {
    sig: 'apunte_guardar(materia, texto)',
    ex: 'apunte de historia: la revolución fue en 1810',
    run({ materia, texto }) {
      materia = String(materia || '').trim();
      texto = String(texto || '').trim();
      if (!materia || !texto) return 'Necesito la materia y el texto del apunte.';
      db().notes.push({ id: uid(), materia, texto, fecha: todayISO() });
      S.save();
      return `Apunte guardado en ${materia}.`;
    }
  },
  apunte_listar: {
    sig: 'apunte_listar(materia?)',
    ex: 'apuntes de historia',
    run({ materia }) {
      let n = db().notes;
      if (materia) n = n.filter(x => norm(x.materia).includes(norm(materia)));
      return lines(n.slice(-10).map(x => `• [${x.materia}] ${x.texto}`), 'No hay apuntes guardados.');
    }
  },
  examen_registrar: {
    sig: 'examen_registrar(materia, fecha="YYYY-MM-DD")',
    ex: 'examen de matemática 15/11',
    run({ materia, fecha }) {
      materia = String(materia || '').trim();
      fecha = okDate(fecha);
      if (!materia || !fecha) return 'Necesito la materia y la fecha del examen.';
      db().exams.push({ id: uid(), materia, fecha });
      S.save();
      return `Examen registrado: ${materia}, ${fmtDate(fecha)}.`;
    }
  },
  examen_listar: {
    sig: 'examen_listar()',
    ex: 'mis exámenes',
    run() {
      const p = db().exams.filter(e => e.fecha >= todayISO()).sort((a, b) => a.fecha.localeCompare(b.fecha));
      return lines(p.map(e => `• ${e.materia} - ${fmtDate(e.fecha)} (faltan ${daysUntil(e.fecha)} días)`), 'No tenés exámenes próximos.');
    }
  },
  plan_estudio: {
    sig: 'plan_estudio(materia, fecha?="YYYY-MM-DD")  [crea una tarea por día hasta el examen]',
    ex: 'plan de estudio matemática',
    run({ materia, fecha }) {
      materia = String(materia || '').trim();
      if (!materia) return '¿Para qué materia querés el plan?';
      fecha = okDate(fecha);
      if (!fecha) {
        const e = db().exams.filter(x => norm(x.materia).includes(norm(materia)) && x.fecha >= todayISO()).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
        if (!e) return `No tengo un examen de ${materia}. Registralo primero o indicá la fecha.`;
        fecha = e.fecha;
        materia = e.materia;
      }
      const dias = daysUntil(fecha);
      if (dias < 1) return 'El examen es hoy o ya pasó: no hay días para planificar.';
      const total = Math.min(dias, 14);
      for (let i = 0; i < total; i++) {
        const f = isoDate(addDays(new Date(fecha + 'T00:00:00'), -(total - i)));
        db().tasks.push({ id: uid(), titulo: `Estudiar ${materia} (${i + 1}/${total})`, fecha: f, hecha: false, creada: new Date().toISOString() });
      }
      S.save();
      return `Plan creado: ${total} sesiones de estudio de ${materia} antes del ${fmtDate(fecha)}. Las ves en tus tareas.`;
    }
  }
};

/* ---------------- ENTRENAMIENTO ---------------- */
const entrenamiento = {
  entreno_registrar: {
    sig: 'entreno_registrar(ejercicio, series?, reps?, peso?, nota?)',
    ex: 'entrené press banca 3x10 60kg',
    run({ ejercicio, series, reps, peso, nota }) {
      ejercicio = String(ejercicio || '').trim();
      if (!ejercicio) return 'Falta el nombre del ejercicio.';
      const p = peso === null || peso === undefined || peso === '' ? null : toNum(peso);
      db().workouts.push({
        id: uid(), fecha: todayISO(), ejercicio,
        series: Number(series) || null, reps: Number(reps) || null,
        peso: p !== null && !isNaN(p) ? p : null, nota: String(nota || '')
      });
      S.save();
      return `Registrado: ${ejercicio}${series && reps ? ' ' + series + 'x' + reps : ''}${p ? ' con ' + p + ' kg' : ''}.`;
    }
  },
  entreno_listar: {
    sig: 'entreno_listar(ejercicio?)',
    ex: 'mis entrenamientos',
    run({ ejercicio }) {
      let w = db().workouts;
      if (ejercicio) w = w.filter(x => norm(x.ejercicio).includes(norm(ejercicio)));
      return lines(w.slice(-10).map(x => `• ${fmtDate(x.fecha)} ${x.ejercicio}${x.series && x.reps ? ' ' + x.series + 'x' + x.reps : ''}${x.peso ? ' ' + x.peso + ' kg' : ''}`), 'No hay entrenamientos registrados.');
    }
  },
  entreno_progreso: {
    sig: 'entreno_progreso(ejercicio)',
    ex: 'progreso press banca',
    run({ ejercicio }) {
      const w = db().workouts.filter(x => norm(x.ejercicio).includes(norm(ejercicio || '')));
      if (!w.length) return 'No tengo registros de ese ejercicio.';
      const conPeso = w.filter(x => x.peso);
      let r = `${w.length} registro(s) de ${w[0].ejercicio}.`;
      if (conPeso.length) {
        const max = Math.max(...conPeso.map(x => x.peso));
        const primero = conPeso[0].peso;
        const ultimo = conPeso[conPeso.length - 1].peso;
        r += ` Peso máximo: ${max} kg. Primer peso: ${primero} kg, último: ${ultimo} kg (${ultimo - primero >= 0 ? '+' : ''}${Math.round((ultimo - primero) * 100) / 100} kg).`;
      }
      return r;
    }
  }
};

/* ---------------- INVESTIGACIÓN ---------------- */
const investigacion = {
  investigacion_guardar: {
    sig: 'investigacion_guardar(tema, texto)  [guarda el resumen o los hallazgos]',
    ex: 'guardar investigación energía solar: texto',
    run({ tema, texto }) {
      tema = String(tema || '').trim();
      texto = String(texto || '').trim();
      if (!tema || !texto) return 'Necesito el tema y el texto.';
      db().research.push({ id: uid(), tema, texto, fecha: todayISO() });
      S.save();
      return `Investigación guardada: ${tema}.`;
    }
  },
  investigacion_listar: {
    sig: 'investigacion_listar()',
    ex: 'mis investigaciones',
    run() {
      return lines(db().research.slice(-10).map(x => `• ${x.tema}: ${x.texto.slice(0, 120)}${x.texto.length > 120 ? '…' : ''}`), 'No hay investigaciones guardadas.');
    }
  }
};

/* ---------------- FINANZAS ---------------- */
function movimiento(tipo, { monto, categoria, nota }) {
  const m = toNum(monto);
  if (!(m > 0)) return 'El monto tiene que ser un número mayor a cero.';
  const cat = String(categoria || '').trim().toLowerCase() || 'general';
  db().transactions.push({ id: uid(), tipo, monto: m, categoria: cat, nota: String(nota || ''), fecha: todayISO() });
  S.save();
  return `${tipo === 'gasto' ? 'Gasto' : 'Ingreso'} registrado: ${money(m)} (${cat}).`;
}

const finanzas = {
  gasto_registrar: {
    sig: 'gasto_registrar(monto, categoria?, nota?)',
    ex: 'gasté 3500 en comida',
    run: a => movimiento('gasto', a)
  },
  ingreso_registrar: {
    sig: 'ingreso_registrar(monto, categoria?, nota?)',
    ex: 'ingresé 200000 sueldo',
    run: a => movimiento('ingreso', a)
  },
  finanzas_balance: {
    sig: 'finanzas_balance(mes?="YYYY-MM")',
    ex: 'balance',
    run({ mes } = {}) {
      mes = /^\d{4}-\d{2}$/.test(String(mes || '')) ? mes : todayISO().slice(0, 7);
      const tx = db().transactions.filter(t => t.fecha.startsWith(mes));
      if (!tx.length) return `No hay movimientos en ${mes}.`;
      const ing = tx.filter(t => t.tipo === 'ingreso').reduce((a, t) => a + t.monto, 0);
      const gas = tx.filter(t => t.tipo === 'gasto').reduce((a, t) => a + t.monto, 0);
      const porCat = {};
      for (const t of tx.filter(x => x.tipo === 'gasto')) porCat[t.categoria] = (porCat[t.categoria] || 0) + t.monto;
      const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
      let r = `Balance de ${mes}:\n• Ingresos: ${money(ing)}\n• Gastos: ${money(gas)}\n• Saldo: ${money(ing - gas)}`;
      if (top.length) r += '\nGastos por categoría:\n' + top.map(([c, v]) => `• ${c}: ${money(v)} (${Math.round((v / gas) * 100)}%)`).join('\n');
      return r;
    }
  },
  finanzas_listar: {
    sig: 'finanzas_listar()',
    ex: 'mis gastos',
    run() {
      return lines(db().transactions.slice(-10).map(t => `• ${fmtDate(t.fecha)} ${t.tipo}: ${money(t.monto)} (${t.categoria})`), 'No hay movimientos registrados.');
    }
  }
};

/* ---------------- NÚCLEO (memoria de JARVIS) ---------------- */
export const CORE = {
  recordar: {
    sig: 'recordar(texto)  [solo si el usuario lo pide; pide confirmación]',
    ex: 'recordá que mi café favorito es el cortado',
    run({ texto }) {
      texto = String(texto || '').trim();
      if (!texto) return 'No me dijiste qué recordar.';
      db().memories.push({ id: uid(), texto, creado: new Date().toISOString() });
      S.save();
      return 'Listo, lo voy a recordar.';
    }
  },
  memorias_listar: {
    sig: 'memorias_listar()',
    ex: 'mis recuerdos',
    run() {
      return lines(db().memories.map(m => `• ${m.texto}`), 'Todavía no guardé ningún recuerdo.');
    }
  },
  olvidar: {
    sig: 'olvidar(texto)  [pide confirmación]',
    ex: 'olvidá mi café favorito',
    run({ texto }) {
      const r = pick(db().memories, 'texto', texto, 'recuerdo');
      if (!r.item) return r.msg;
      db().memories = db().memories.filter(m => m.id !== r.item.id);
      S.save();
      return `Olvidado: ${r.item.texto}`;
    }
  }
};

/* ---------------- Definición de agentes (para la pantalla y para la IA) ---------------- */
const T = {
  tareas: { key: 'tasks', label: 'Tareas', line: t => `${t.hecha ? '[hecha] ' : ''}${t.titulo}${t.fecha ? ' (' + fmtDate(t.fecha) + ')' : ''}` },
  recordatorios: { key: 'reminders', label: 'Recordatorios', line: r => `${r.texto} (${fmtDateTime(r.cuando)})${r.avisado ? ' [avisado]' : ''}` },
  objetivos: { key: 'goals', label: 'Objetivos', line: g => `${g.cumplido ? '[cumplido] ' : ''}${g.titulo}` },
  apuntes: { key: 'notes', label: 'Apuntes', line: n => `[${n.materia}] ${n.texto}` },
  examenes: { key: 'exams', label: 'Exámenes', line: e => `${e.materia} - ${fmtDate(e.fecha)}` },
  entrenos: { key: 'workouts', label: 'Entrenamientos', line: w => `${fmtDate(w.fecha)} ${w.ejercicio}${w.series && w.reps ? ' ' + w.series + 'x' + w.reps : ''}${w.peso ? ' ' + w.peso + ' kg' : ''}` },
  investigaciones: { key: 'research', label: 'Investigaciones', line: r => `${r.tema}: ${r.texto.slice(0, 80)}` },
  movimientos: { key: 'transactions', label: 'Movimientos', line: t => `${fmtDate(t.fecha)} ${t.tipo} ${money(t.monto)} (${t.categoria})` }
};

export const AGENTS = {
  organizador: {
    name: 'Organizador',
    desc: 'Tareas, recordatorios, objetivos y agenda.',
    base: 'Administrás tareas, recordatorios, objetivos y la agenda. Si falta la fecha u hora de algo, preguntala antes de crearlo.',
    funcs: organizador,
    collections: [T.tareas, T.recordatorios, T.objetivos]
  },
  estudio: {
    name: 'Estudio',
    desc: 'Apuntes, materias, exámenes, explicaciones y planes de estudio.',
    base: 'Ayudás a estudiar: guardás apuntes, registrás exámenes, explicás contenidos con claridad y armás planes de estudio.',
    funcs: estudio,
    collections: [T.apuntes, T.examenes]
  },
  entrenamiento: {
    name: 'Entrenamiento',
    desc: 'Rutinas, ejercicios y progreso físico.',
    base: 'Registrás entrenamientos y ejercicios, y mostrás el progreso. No des consejos médicos; ante dolor o lesiones sugerí consultar a un profesional.',
    funcs: entrenamiento,
    collections: [T.entrenos]
  },
  investigacion: {
    name: 'Investigación',
    desc: 'Investigar temas, comparar alternativas y resumir. Guarda los resultados.',
    base: 'Investigás, analizás y comparás información, y resumís textos. Si no estás seguro de un dato, decilo; no inventes fuentes. Podés guardar un resumen con investigacion_guardar.',
    funcs: investigacion,
    collections: [T.investigaciones]
  },
  finanzas: {
    name: 'Finanzas',
    desc: 'Gastos, ingresos, presupuestos y estadísticas.',
    base: 'Registrás gastos e ingresos y calculás balances y estadísticas con los datos guardados. No des recomendaciones de inversión.',
    funcs: finanzas,
    collections: [T.movimientos]
  }
};

const ALL = {};
for (const a of Object.values(AGENTS)) Object.assign(ALL, a.funcs);
Object.assign(ALL, CORE);

const SENSITIVE = new Set(['tarea_eliminar', 'olvidar']);
const looksSensitive = t => /(contrase[nñ]a|password|clave|tarjeta|cvv|\bdni\b|pasaporte|cuenta bancaria|\b\d{13,19}\b)/i.test(t);

export const agentInstructions = id => db().agentInstructions[id] || AGENTS[id].base;

export function funcSpecs() {
  const out = [];
  for (const [id, a] of Object.entries(AGENTS)) {
    out.push(`[${id}] ${a.name}. ${agentInstructions(id)}`);
    for (const f of Object.values(a.funcs)) out.push('  - ' + f.sig);
  }
  out.push('[jarvis] Núcleo (memoria del usuario)');
  for (const f of Object.values(CORE)) out.push('  - ' + f.sig);
  return out.join('\n');
}

// Ejecuta una acción (del modo sin IA o propuesta por la IA). Las sensibles piden confirmación.
export async function execute(action, { source = 'user', confirm }) {
  const fn = String(action?.fn || '');
  const def = ALL[fn];
  if (!def) return `No existe la función "${fn}".`;
  const args = action.args && typeof action.args === 'object' ? action.args : {};
  let ask = null;
  if (SENSITIVE.has(fn)) ask = `Vas a eliminar datos (${fn.replace('_', ' ')}: ${JSON.stringify(args)}). No se puede deshacer.`;
  else if (fn === 'recordar' && looksSensitive(String(args.texto || ''))) ask = 'Este recuerdo parece contener información sensible (claves, tarjetas o documentos). ¿Querés guardarlo igual?';
  else if (fn === 'recordar' && source === 'ai') ask = `JARVIS quiere guardar este recuerdo: "${args.texto}". ¿Lo guardo?`;
  if (ask && !(await confirm(ask))) return 'Cancelado.';
  try {
    return String(await def.run(args));
  } catch (e) {
    console.error(e);
    return `Hubo un error ejecutando ${fn}.`;
  }
}
