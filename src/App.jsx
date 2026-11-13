import { useState, useEffect, useMemo, useRef } from "react";
import {
  Clock, MapPin, Euro, Calendar, Download, Settings as SettingsIcon,
  Plus, Trash2, Pencil, X, Check, CalendarDays, Coffee, Car, Utensils,
  ListChecks, AlertCircle, ChevronLeft, ChevronRight, History, Percent,
  TrendingUp, CalendarRange, Upload, RotateCcw
} from "lucide-react";

if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return null;
        return { key, value: raw, shared: false };
      } catch (e) {
        return null;
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(key, value);
        return { key, value, shared: false };
      } catch (e) {
        return null;
      }
    },
    async delete(key) {
      try {
        localStorage.removeItem(key);
        return { key, deleted: true, shared: false };
      } catch (e) {
        return null;
      }
    },
    async list(prefix) {
      try {
        const keys = Object.keys(localStorage).filter((k) => !prefix || k.startsWith(prefix));
        return { keys, prefix, shared: false };
      } catch (e) {
        return null;
      }
    },
  };
}

const STORAGE_KEY = "app-data";

const DEFAULT_FESTIUS_2026 = [
  "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06",
  "2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01",
  "2026-06-24",
  "2026-08-19",
  "2026-09-11", "2026-09-23",
  "2026-10-12",
  "2026-12-07", "2026-12-08", "2026-12-25",
];

const DEFAULT_WORKPLACES = [
  { id: "tarragona", name: "Tarragona", km: 0, autoDieta: false, horari: "partit" },
  { id: "vandellos2", name: "Vandellós II", km: 90, autoDieta: true },
  { id: "asco", name: "Ascó", km: 146, autoDieta: true },
];

const DEFAULT_SETTINGS_VERSION = {
  id: "v1",
  effectiveFrom: "2026-01-01",
  souBase: 0,
  preuHoraExtra: 0,
  preuKm: 0.47,
  mitjaDieta: 19.50,
  dietaCompleta: 39.01,
  plusParadaNormal: 33.70,
  plusParadaFestiu: 74.15,
  plusNocturnitat: 0,
};

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

const WEEKDAYS_BY_LANG = {
  ca: ["Dl", "Dm", "Dc", "Dj", "Dv", "Ds", "Dg"],
  es: ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"],
};
const MONTH_NAMES_BY_LANG = {
  ca: ["Gener", "Febrer", "Març", "Abril", "Maig", "Juny", "Juliol", "Agost", "Setembre", "Octubre", "Novembre", "Desembre"],
  es: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
};
const LANGUAGES = [
  { code: "ca", label: "Català" },
  { code: "es", label: "Castellano" },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isWeekendDate(dateStr) {
  const dow = new Date(dateStr + "T00:00:00").getDay();
  return dow === 0 || dow === 6;
}

function isHolidayDate(dateStr, festius) {
  return isWeekendDate(dateStr) || festius.includes(dateStr);
}

const isPartit = (w) => !!w && (w.horari === "partit" || (w.horari === undefined && w.id === "tarragona"));

function getStandardSchedule(dateStr, wp, reduced = []) {
  const rd = reduced.find((r) => r.date === dateStr);
  if (rd) return { start: rd.start, end: rd.end, split: false, hours: Math.max(0, (timeToMinutes(rd.end) - timeToMinutes(rd.start)) / 60) };
  const d = new Date(dateStr + "T00:00:00");
  const month = d.getMonth() + 1, day = d.getDate(), dow = d.getDay();
  const fri = dow === 5, weekend = dow === 0 || dow === 6;
  const inSummer = (month === 7 && day >= 2) || (month === 8 && day <= 28);
  if (month === 12 && (day === 24 || day === 31)) return { start: "08:00", end: "14:00", split: false, hours: 6 };
  if (inSummer) return fri ? { start: "08:00", end: "14:00", split: false, hours: 6 } : { start: "08:00", end: "15:00", split: false, hours: 7 };
  if (isPartit(wp) && !weekend) return fri ? { start: "08:00", end: "14:00", split: false, hours: 6 } : { start: "08:00", end: "17:30", split: true, hours: 8.5 };
  return { start: "07:00", end: "15:00", split: false, hours: 8 };
}

function nightHours(start, end) {
  const s = timeToMinutes(start);
  let e = timeToMinutes(end);
  if (e <= s) e += 1440;
  return [[0, 360], [1320, 1800], [2760, 3240]].reduce((tot, [a, b]) => tot + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0) / 60;
}

function resolveParada(entry, parades = []) {
  if (["normal", "festiu", "none"].includes(entry.parada)) return entry.parada;
  const p = parades.find((x) => x.workplaceId === entry.workplaceId && x.start <= entry.date && entry.date <= x.end);
  return p ? (entry.festiu ? "festiu" : "normal") : "none";
}

function getSettingsForDate(dateStr, versions) {
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let applicable = sorted[0];
  for (const v of sorted) {
    if (v.effectiveFrom <= dateStr) applicable = v;
  }
  return applicable;
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function normalizeEntry(e) {
  const tickets = Array.isArray(e.tickets) ? e.tickets : (e.ticketConcept || e.ticketAmount || e.ticketDesc ? [{ concept: e.ticketConcept || "", amount: e.ticketAmount || "", desc: e.ticketDesc || "" }] : []);
  const { ticketConcept, ticketAmount, ticketDesc, ...rest } = e;
  return { ...rest, tickets, dayType: e.dayType || "", nocturnMode: e.nocturnMode || "auto", ot: e.ot || "" };
}

function emptyForm(dateStr, festius, reduced = []) {
  const sc = getStandardSchedule(dateStr, null, reduced);
  return {
    id: null, date: dateStr, workplaceId: "", start: sc.start, end: sc.end, splitDay: sc.split,
    festiu: isHolidayDate(dateStr, festius), kmMode: "auto", kmManual: 0, dietMode: "none",
    parada: "none", nocturnMode: "auto", ot: "", tickets: [], ticketsOn: false, dayType: "", notes: "",
    timesTouched: false, dietTouched: false, paradaTouched: false,
  };
}

function resolveDiet(entry, workplace, rawHours) {
  if (entry.dietMode !== "auto") return entry.dietMode;
  return workplace && workplace.autoDieta && rawHours > 8 ? "mitja" : "none";
}

function computeEntry(entry, settingsVersions, workplaces, festius, parades = [], reduced = []) {
  const s = getSettingsForDate(entry.date, settingsVersions);
  const workplace = workplaces.find((w) => w.id === entry.workplaceId);
  const schedule = getStandardSchedule(entry.date, workplace, reduced);
  const ticketsAmount = (entry.tickets || []).reduce((a, tk) => a + (Number(tk.amount) || 0), 0);
  const dd = (entry.dayType === "descans" || entry.dayType === "baixa") && ["mitja", "completa"].includes(entry.dietMode) ? entry.dietMode : "none";
  const dAmt = dd === "mitja" ? s.mitjaDieta : dd === "completa" ? s.dietaCompleta : 0;
  if (entry.dayType) return { totalHours: 0, normalHours: 0, extraHours: 0, extraHoursAmount: 0, standardHours: 0, km: 0, kmAmount: 0, dietResolved: dd, dietAmount: dAmt, paradaAmount: 0, paradaMode: "none", nightH: 0, nocturnAmount: 0, ticketsAmount, totalExtra: dAmt, holiday: entry.festiu, workplaceName: workplace ? workplace.name : "—", settingsUsed: s };

  let startMin = timeToMinutes(entry.start);
  let endMin = timeToMinutes(entry.end);
  if (endMin <= startMin) endMin += 24 * 60;
  const rawHours = (endMin - startMin) / 60;
  let totalHours = entry.splitDay ? rawHours - 1 : rawHours;
  totalHours = Math.max(0, totalHours);

  const holiday = entry.festiu;
  let normalHours, extraHours;
  if (holiday) {
    normalHours = 0;
    extraHours = totalHours;
  } else {
    normalHours = Math.min(totalHours, schedule.hours);
    extraHours = Math.max(0, totalHours - schedule.hours);
  }
  const extraHoursAmount = extraHours * s.preuHoraExtra;

  const km = entry.kmMode === "manual" ? Number(entry.kmManual) || 0 : workplace ? workplace.km : 0;
  const kmAmount = km * s.preuKm;

  const dietResolved = resolveDiet(entry, workplace, rawHours);
  const dietAmount = dietResolved === "mitja" ? s.mitjaDieta : dietResolved === "completa" ? s.dietaCompleta : 0;

  const paradaMode = resolveParada(entry, parades);
  const paradaAmount = paradaMode === "normal" ? s.plusParadaNormal : paradaMode === "festiu" ? s.plusParadaFestiu : 0;
  const nightH = entry.nocturnMode === "off" ? 0 : nightHours(entry.start, entry.end);
  const nocturnAmount = nightH * (s.plusNocturnitat || 0);

  const totalExtra = extraHoursAmount + kmAmount + dietAmount + paradaAmount + nocturnAmount;

  return {
    totalHours, normalHours, extraHours, extraHoursAmount, standardHours: schedule.hours,
    km, kmAmount, dietResolved, dietAmount, paradaAmount, paradaMode, nightH, nocturnAmount, ticketsAmount, totalExtra, holiday,
    workplaceName: workplace ? workplace.name : entry.workplaceId ? "—" : "Manual",
    settingsUsed: s,
  };
}

function fmt(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString("ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtHoursCompact(n) {
  const rounded = Math.round((n || 0) * 2) / 2; // nearest half hour
  return `${rounded}`;
}

function monthLabel(monthStr, lang) {
  const [y, m] = monthStr.split("-");
  return `${MONTH_NAMES_BY_LANG[lang][Number(m) - 1]} ${y}`;
}

function shiftMonth(monthStr, delta) {
  let [y, m] = monthStr.split("-").map(Number);
  m += delta;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthsBetween(startStr, endStr) {
  const startYM = startStr.slice(0, 7);
  const endYM = endStr.slice(0, 7);
  const months = [];
  let cur = startYM;
  let guard = 0;
  while (cur <= endYM && guard < 600) {
    months.push(cur);
    cur = shiftMonth(cur, 1);
    guard++;
  }
  return months;
}

const STRINGS = {
  ca: {
    redo_btn: "Tirar endavant",
    reduced_title: "Jornada reduïda",
    reduced_note: "Dies de jornada reduïda i les hores que s'haurien de treballar. Surten en taronja al calendari.",
    legend_reduced: "Jornada reduïda",
    daytype_counts: "Dies sense treball a l'interval",
    paid: "Pagada",
    other_place: "Altre",
    legend_festiu: "Festiu",
    daytype_title: "Tipus de dia",
    daytype_work: "Treball",
    daytype_descans: "Descans",
    daytype_vacances: "Vacances",
    daytype_baixa: "Baixa",
    daytype_personal: "Dia personal",
    daytype_altres: "Altres",
    ab_descans: "Desc.",
    ab_vacances: "Vac.",
    ab_baixa: "Baixa",
    ab_personal: "D. Per.",
    ab_altres: "Altre",
    add_ticket: "Afegeix tiquet",
    no_tickets: "No hi ha tiquets en l'interval.",
    tickets_note: "No compten als totals de diners.",
    dup_warn: "Ja existeix un fitxatge per a aquest dia. Si continues, s'esborrarà l'anterior.",
    dup_accept: "Accepta i continua",
    ot_title: "OT",
    ot_note: "Afegeix les OT. A fitxatge sortiran en un desplegable, primer les últimes utilitzades.",
    ot_placeholder: "Nom de l'OT",
    undo_btn: "Tirar enrere l'últim canvi",
    import_button: "Importa còpia (Excel)",
    import_note: "Importa una còpia completa: afegeix els dies i la configuració que falten, sense esborrar el que ja tens.",
    import_err: "No s'ha pogut llegir l'Excel.",
    import_ok: (a, s) => `Importats ${a} dies${s ? ` (${s} omesos: ja existien)` : ""}.`,
    diet_short_mitja: "Mitja",
    diet_short_completa: "Completa",
    legend_parada_festiu: "Parada festiu",
    backup_button: "Còpia completa (Excel)",
    backup_note: "Exporta totes les dades (fitxatges, preus, llocs, parades, festius) en un Excel, per poder-les importar en una versió futura.",
    schedule_note: (a, b, h) => `Horari estàndard: ${a}–${b} (${h}h). Pots canviar-lo si el dia és diferent.`,
    km_reset: (n) => `Tornar als km configurats (${n})`,
    parada_auto: "Auto",
    parada_auto_hint: "S'aplicarà:",
    nocturn_label: "Plus nocturnitat",
    label_ot: "OT",
    tickets_title: "Tiquets / gasolina, etc.",
    ticket_concept: "Concepte",
    ticket_desc: "Descripció",
    legend_parada: "Parada",
    acum_title: "Acumulat any",
    until_month: (m) => `fins ${m}`,
    f_plusNocturnitat: "Plus nocturnitat (€/h)",
    partit_on: "Horari partit: sí",
    partit_off: "Horari partit: no",
    parades_title: "Parades",
    parades_note: "Dins de l'interval, si fitxes a eixa central, es marca sol el plus normal o festiu.",
    parada_central: "Central…",
    add_parada: "Afegeix parada",
    no_entries_range: "No hi ha fitxatges en l'interval.",
    split_day: "Jornada partida",
    holiday_checkbox: "Festiu",
    export_button: "Exporta l'interval a Excel (.xlsx)",
    export_note: "Descarrega un Excel amb un dia per fila i el total, de l'interval de dates de dalt.",
    save_error: "No s'ha pogut desar. Comprova la connexió i torna-ho a provar.",
    edit_entry: "Edita el fitxatge", new_entry: "Nou fitxatge",
    label_date: "Data", label_start: "Hora inici", label_end: "Hora fi",
    label_workplace: "Lloc de treball", option_manual: "— Cap / manual —",
    label_km: "Km", km_manual_checkbox: "Km manual (dia especial)",
    km_manual_placeholder: "Km d'avui", km_auto_note: "(automàtic segons el lloc)",
    km_select_prompt: "Selecciona un lloc o marca km manual",
    label_diet: "Dieta", diet_auto_option: "Automàtica (mitja dieta si >8h a Ascó/Vandellós)",
    diet_none: "Cap", diet_mitja: "Mitja dieta", diet_completa: "Dieta completa",
    label_parada: "Plus de parada", parada_none: "Cap", parada_normal: "Normal", parada_festiu: "Festiu",
    label_notes: "Descripció/Observacions", notes_placeholder: "Ex: muntatge, revisió, avaria...",
    btn_update: "Actualitza", btn_add_entry: "Afegeix fitxatge", btn_cancel: "Cancel·la",
    recent_entries: "Fitxatges recents", badge_festiu: "festiu", extra_suffix: "extra",
    extra_day: "Extra dia:", empty_entries: "Encara no hi ha cap fitxatge.",
    legend_base: "Hores base", legend_extra: "Hores extra",
    day_schedule: "Horari:", day_split_note: "(jornada partida)", day_festiu: "Festiu:",
    yes: "Sí", no: "No", day_workplace: "Lloc:", day_km: "Km:", day_diet: "Dieta:",
    day_parada: "Plus de parada:", day_hours: "Hores normals / extra:",
    day_total_extra: "Total extra del dia:", btn_edit: "Edita", btn_delete: "Elimina",
    no_entry_day: "No hi ha cap fitxatge aquest dia.", btn_add_for_day: "Afegeix fitxatge per aquest dia",
    month_base_label: "Sou base d'aquest mes (€) — canvia'l si hi ha hagut una baixa o incidència",
    restore_default: "Restaura el sou base per defecte", total_gross: "Total brut a cobrar",
    retention_label: "Retenció Hisenda", net_suffix: "net",
    normal_hours_card: "Hores normals", extra_hours_card: "Hores extra",
    km_card: "Km", diets_card: "Dietes", parada_card: "Plus de parada",
    accumulated_year: (y, m) => `Acumulat l'any ${y} (fins ${m})`,
    base_accum: "Sou base acumulat", extra_accum: "Extres acumulats",
    total_gross2: "Total brut", total_net_est: "Total net estimat",
    projection_label: "Projecció a final d'any (si segueixes al mateix ritme)", gross_suffix: "brut",
    range_title: "Resum per interval de dates", from_label: "Des de", to_label: "Fins a",
    invalid_range: "La data d'inici ha de ser anterior a la data final.",
    entries_in_range: (n) => `${n} fitxatge${n !== 1 ? "s" : ""} en l'interval`,
    base_months: "Sou base (mesos inclosos)", km_total_range: "Km totals",
    mitges_dietes: "Mitges dietes", dietes_completes: "Dietes completes",
    parada_normal_range: "Plus parada normal", parada_festiu_range: "Plus parada festiu",
    total_gross_range: "Total brut de l'interval", net_estimate: (p) => `Net estimat (${p}%)`,
    proportional_note: (m) => `El sou base es calcula de forma proporcional als dies exactes de l'interval dins de cada mes (${m}).`,
    month_entries_title: (m) => `Fitxatges de ${m}`, no_entries_month: "Sense fitxatges aquest mes.",
    price_history_title: "Historial de preus",
    price_history_note: "Cada versió s'aplica a partir de la data indicada, sense alterar els fitxatges anteriors.",
    effective_from: "Vigent des de",
    f_souBase: "Sou base mensual (€)", f_preuHoraExtra: "Preu hora extra (€/h)", f_preuKm: "Preu per km (€/km)",
    f_mitjaDieta: "Mitja dieta (€)", f_dietaCompleta: "Dieta completa (€)",
    f_plusParadaNormal: "Plus parada normal (€)", f_plusParadaFestiu: "Plus parada festiu (€)",
    add_version_btn: "Afegeix una nova versió de preus",
    workplaces_title: "Llocs de treball", name_placeholder: "Nom del lloc", km_placeholder: "Km",
    auto_diet_checkbox: "Aplica mitja dieta automàtica si es superen les 8h",
    add_workplace_btn: "Afegeix lloc", auto_diet_badge: "dieta auto",
    deactivate: "Desactiva", activate_diet: "Activa dieta",
    no_workplaces: "Encara no has afegit cap lloc de treball.",
    festius_title: "Dies festius",
    festius_note: "Ja hi ha carregats els festius del 2026. Els caps de setmana es compten sempre automàticament. Afegeix aquí els festius d'altres anys quan els necessitis.",
    language_title: "Idioma", loading: "Carregant...",
    nav_fitxatge: "Fitxatge", nav_calendari: "Calendari", nav_resum: "Resum", nav_config: "Configuració",
  },
  es: {
    redo_btn: "Rehacer",
    reduced_title: "Jornada reducida",
    reduced_note: "Días de jornada reducida y las horas que se deberían trabajar. Salen en naranja en el calendario.",
    legend_reduced: "Jornada reducida",
    daytype_counts: "Días sin trabajo en el intervalo",
    paid: "Pagada",
    other_place: "Otro",
    legend_festiu: "Festivo",
    daytype_title: "Tipo de día",
    daytype_work: "Trabajo",
    daytype_descans: "Descanso",
    daytype_vacances: "Vacaciones",
    daytype_baixa: "Baja",
    daytype_personal: "Día personal",
    daytype_altres: "Otros",
    ab_descans: "Desc.",
    ab_vacances: "Vac.",
    ab_baixa: "Baja",
    ab_personal: "D. Per.",
    ab_altres: "Otro",
    add_ticket: "Añadir tique",
    no_tickets: "No hay tiques en el intervalo.",
    tickets_note: "No cuentan en los totales de dinero.",
    dup_warn: "Ya existe un fichaje para este día. Si continúas, se borrará el anterior.",
    dup_accept: "Aceptar y continuar",
    ot_title: "OT",
    ot_note: "Añade las OT. En fichaje saldrán en un desplegable, primero las últimas usadas.",
    ot_placeholder: "Nombre de la OT",
    undo_btn: "Deshacer el último cambio",
    import_button: "Importar copia (Excel)",
    import_note: "Importa una copia completa: añade los días y la configuración que faltan, sin borrar lo que ya tienes.",
    import_err: "No se ha podido leer el Excel.",
    import_ok: (a, s) => `Importados ${a} días${s ? ` (${s} omitidos: ya existían)` : ""}.`,
    diet_short_mitja: "Media",
    diet_short_completa: "Completa",
    legend_parada_festiu: "Parada festivo",
    backup_button: "Copia completa (Excel)",
    backup_note: "Exporta todos los datos (fichajes, precios, lugares, paradas, festivos) en un Excel, para poder importarlos en una versión futura.",
    schedule_note: (a, b, h) => `Horario estándar: ${a}–${b} (${h}h). Puedes cambiarlo si el día es diferente.`,
    km_reset: (n) => `Volver a los km configurados (${n})`,
    parada_auto: "Auto",
    parada_auto_hint: "Se aplicará:",
    nocturn_label: "Plus nocturnidad",
    label_ot: "OT",
    tickets_title: "Tiques / gasolina, etc.",
    ticket_concept: "Concepto",
    ticket_desc: "Descripción",
    legend_parada: "Parada",
    acum_title: "Acumulado año",
    until_month: (m) => `hasta ${m}`,
    f_plusNocturnitat: "Plus nocturnidad (€/h)",
    partit_on: "Horario partido: sí",
    partit_off: "Horario partido: no",
    parades_title: "Paradas",
    parades_note: "Dentro del intervalo, si fichas en esa central, se marca solo el plus normal o festivo.",
    parada_central: "Central…",
    add_parada: "Añadir parada",
    no_entries_range: "No hay fichajes en el intervalo.",
    split_day: "Jornada partida",
    holiday_checkbox: "Festivo",
    export_button: "Exportar el intervalo a Excel (.xlsx)",
    export_note: "Descarga un Excel con un día por fila y el total, del intervalo de fechas de arriba.",
    save_error: "No se ha podido guardar. Comprueba la conexión e inténtalo de nuevo.",
    edit_entry: "Editar el fichaje", new_entry: "Nuevo fichaje",
    label_date: "Fecha", label_start: "Hora inicio", label_end: "Hora fin",
    label_workplace: "Lugar de trabajo", option_manual: "— Ninguno / manual —",
    label_km: "Km", km_manual_checkbox: "Km manual (día especial)",
    km_manual_placeholder: "Km de hoy", km_auto_note: "(automático según el lugar)",
    km_select_prompt: "Selecciona un lugar o marca km manual",
    label_diet: "Dieta", diet_auto_option: "Automática (media dieta si >8h en Ascó/Vandellós)",
    diet_none: "Ninguna", diet_mitja: "Media dieta", diet_completa: "Dieta completa",
    label_parada: "Plus de parada", parada_none: "Ninguno", parada_normal: "Normal", parada_festiu: "Festivo",
    label_notes: "Descripción/Observaciones", notes_placeholder: "Ej: montaje, revisión, avería...",
    btn_update: "Actualizar", btn_add_entry: "Añadir fichaje", btn_cancel: "Cancelar",
    recent_entries: "Fichajes recientes", badge_festiu: "festivo", extra_suffix: "extra",
    extra_day: "Extra del día:", empty_entries: "Todavía no hay ningún fichaje.",
    legend_base: "Horas base", legend_extra: "Horas extra",
    day_schedule: "Horario:", day_split_note: "(jornada partida)", day_festiu: "Festivo:",
    yes: "Sí", no: "No", day_workplace: "Lugar:", day_km: "Km:", day_diet: "Dieta:",
    day_parada: "Plus de parada:", day_hours: "Horas normales / extra:",
    day_total_extra: "Total extra del día:", btn_edit: "Editar", btn_delete: "Eliminar",
    no_entry_day: "No hay ningún fichaje este día.", btn_add_for_day: "Añadir fichaje para este día",
    month_base_label: "Salario base de este mes (€) — cámbialo si ha habido una baja o incidencia",
    restore_default: "Restaurar el salario base por defecto", total_gross: "Total bruto a cobrar",
    retention_label: "Retención Hacienda", net_suffix: "neto",
    normal_hours_card: "Horas normales", extra_hours_card: "Horas extra",
    km_card: "Km", diets_card: "Dietas", parada_card: "Plus de parada",
    accumulated_year: (y, m) => `Acumulado del año ${y} (hasta ${m})`,
    base_accum: "Salario base acumulado", extra_accum: "Extras acumulados",
    total_gross2: "Total bruto", total_net_est: "Total neto estimado",
    projection_label: "Proyección a fin de año (si sigues al mismo ritmo)", gross_suffix: "bruto",
    range_title: "Resumen por intervalo de fechas", from_label: "Desde", to_label: "Hasta",
    invalid_range: "La fecha de inicio debe ser anterior a la fecha final.",
    entries_in_range: (n) => `${n} fichaje${n !== 1 ? "s" : ""} en el intervalo`,
    base_months: "Salario base (meses incluidos)", km_total_range: "Km totales",
    mitges_dietes: "Medias dietas", dietes_completes: "Dietas completas",
    parada_normal_range: "Plus parada normal", parada_festiu_range: "Plus parada festivo",
    total_gross_range: "Total bruto del intervalo", net_estimate: (p) => `Neto estimado (${p}%)`,
    proportional_note: (m) => `El salario base se calcula de forma proporcional a los días exactos del intervalo dentro de cada mes (${m}).`,
    month_entries_title: (m) => `Fichajes de ${m}`, no_entries_month: "Sin fichajes este mes.",
    price_history_title: "Historial de precios",
    price_history_note: "Cada versión se aplica a partir de la fecha indicada, sin alterar los fichajes anteriores.",
    effective_from: "Vigente desde",
    f_souBase: "Salario base mensual (€)", f_preuHoraExtra: "Precio hora extra (€/h)", f_preuKm: "Precio por km (€/km)",
    f_mitjaDieta: "Media dieta (€)", f_dietaCompleta: "Dieta completa (€)",
    f_plusParadaNormal: "Plus parada normal (€)", f_plusParadaFestiu: "Plus parada festivo (€)",
    add_version_btn: "Añadir una nueva versión de precios",
    workplaces_title: "Lugares de trabajo", name_placeholder: "Nombre del lugar", km_placeholder: "Km",
    auto_diet_checkbox: "Aplicar media dieta automática si se superan las 8h",
    add_workplace_btn: "Añadir lugar", auto_diet_badge: "dieta auto",
    deactivate: "Desactivar", activate_diet: "Activar dieta",
    no_workplaces: "Todavía no has añadido ningún lugar de trabajo.",
    festius_title: "Días festivos",
    festius_note: "Ya están cargados los festivos de 2026. Los fines de semana se cuentan siempre automáticamente. Añade aquí los festivos de otros años cuando los necesites.",
    language_title: "Idioma", loading: "Cargando...",
    nav_fitxatge: "Fichaje", nav_calendari: "Calendario", nav_resum: "Resumen", nav_config: "Configuración",
  },
};

const inputCls = "mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#be0936]";
const cardCls = "bg-slate-900 rounded-xl shadow-sm border border-slate-800 p-4";
const labelCls = "text-xs text-slate-400";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [settingsVersions, setSettingsVersions] = useState([DEFAULT_SETTINGS_VERSION]);
  const [retencioPercent, setRetencioPercent] = useState(15);
  const [workplaces, setWorkplaces] = useState(DEFAULT_WORKPLACES);
  const [festius, setFestius] = useState(DEFAULT_FESTIUS_2026);
  const [entries, setEntries] = useState([]);
  const [monthlyBaseOverrides, setMonthlyBaseOverrides] = useState({});
  const [lang, setLang] = useState("ca");
  const [parades, setParades] = useState([]);
  const [paradaForm, setParadaForm] = useState({ workplaceId: "", start: "", end: "" });
  const [exportMsg, setExportMsg] = useState("");
  const [ots, setOts] = useState([]);
  const [otInput, setOtInput] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [undoStack, setUndoStack] = useState([]);
  const [dupConfirm, setDupConfirm] = useState(false);
  const [reducedDays, setReducedDays] = useState([]);
  const [reducedForm, setReducedForm] = useState({ date: "", start: "08:00", end: "14:00" });
  const [redoStack, setRedoStack] = useState([]);
  const prevCfg = useRef(null);
  const lastPush = useRef(0);
  const skipUndo = useRef(false);

  useEffect(() => {
    if (loading) return;
    const cur = JSON.stringify({ settingsVersions, workplaces, parades, festius, reducedDays, ots, retencioPercent, monthlyBaseOverrides });
    if (prevCfg.current === null || cur === prevCfg.current) { prevCfg.current = cur; return; }
    if (skipUndo.current) { skipUndo.current = false; prevCfg.current = cur; return; }
    const now = Date.now();
    if (now - lastPush.current > 1500) { const old = JSON.parse(prevCfg.current); setUndoStack((s) => [...s.slice(-9), old]); }
    setRedoStack([]);
    lastPush.current = now;
    prevCfg.current = cur;
  }, [settingsVersions, workplaces, parades, festius, reducedDays, ots, retencioPercent, monthlyBaseOverrides, loading]);

  useEffect(() => {
    if (!loading) { try { window.storage.set("app-undo", JSON.stringify(undoStack), false); } catch (e) { /* ignore */ } }
  }, [undoStack, loading]);

  const [tab, setTab] = useState("fitxatge");
  const [form, setForm] = useState(emptyForm(todayStr(), DEFAULT_FESTIUS_2026));
  const [wpForm, setWpForm] = useState({ name: "", km: "", autoDieta: false });
  const [festiuInput, setFestiuInput] = useState("");
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [rangeStart, setRangeStart] = useState(todayStr().slice(0, 7) + "-01");
  const [rangeEnd, setRangeEnd] = useState(todayStr());
  const [selectedDay, setSelectedDay] = useState(null);
  const [saveError, setSaveError] = useState(false);

  function tr(key, ...args) {
    const entry = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.ca[key] || key;
    return typeof entry === "function" ? entry(...args) : entry;
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          const data = JSON.parse(res.value);
          setSettingsVersions(data.settingsVersions && data.settingsVersions.length ? data.settingsVersions : [DEFAULT_SETTINGS_VERSION]);
          setRetencioPercent(typeof data.retencioPercent === "number" ? data.retencioPercent : 15);
          setWorkplaces(data.workplaces && data.workplaces.length ? data.workplaces : DEFAULT_WORKPLACES);
          setFestius(data.festius && data.festius.length ? data.festius : DEFAULT_FESTIUS_2026);
          setEntries((data.entries || []).map(normalizeEntry));
          setOts(data.ots || []);
          setReducedDays(data.reducedDays || []);
          try { const u = await window.storage.get("app-undo", false); if (u && u.value) setUndoStack(JSON.parse(u.value)); } catch (e) { /* none */ }
          setMonthlyBaseOverrides(data.monthlyBaseOverrides || {});
          setLang(data.lang === "es" ? "es" : "ca");
          setParades(data.parades || []);
        }
      } catch (e) {
        // primera vegada, es queda amb els valors per defecte
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function persist(next) {
    const payload = {
      settingsVersions: next.settingsVersions ?? settingsVersions,
      retencioPercent: next.retencioPercent ?? retencioPercent,
      workplaces: next.workplaces ?? workplaces,
      festius: next.festius ?? festius,
      entries: next.entries ?? entries,
      monthlyBaseOverrides: next.monthlyBaseOverrides ?? monthlyBaseOverrides,
      lang: next.lang ?? lang,
      parades: next.parades ?? parades,
      ots: next.ots ?? ots,
      reducedDays: next.reducedDays ?? reducedDays,
    };
    try {
      const result = await window.storage.set(STORAGE_KEY, JSON.stringify(payload), false);
      setSaveError(!result);
    } catch (e) {
      setSaveError(true);
    }
  }

  function handleDateChange(dateStr) {
    const sc = getStandardSchedule(dateStr, workplaces.find((w) => w.id === form.workplaceId), reducedDays);
    setForm((f) => ({ ...f, date: dateStr, festiu: isHolidayDate(dateStr, festius), ...(f.id || f.timesTouched ? {} : { start: sc.start, end: sc.end, splitDay: sc.split }) }));
  }

  function handleWorkplaceChange(id) {
    const sc = getStandardSchedule(form.date, workplaces.find((w) => w.id === id), reducedDays);
    setForm((f) => ({ ...f, workplaceId: id, kmMode: "auto", ...(f.id || f.timesTouched ? {} : { start: sc.start, end: sc.end, splitDay: sc.split }) }));
  }

  useEffect(() => {
    const wp = workplaces.find((w) => w.id === form.workplaceId);
    let s = timeToMinutes(form.start), e = timeToMinutes(form.end);
    if (e <= s) e += 1440;
    const autoOn = !!wp && wp.autoDieta && (e - s) / 60 > 8;
    setForm((f) => {
      if (f.dayType || f.dietTouched) return f;
      const want = autoOn ? "mitja" : "none";
      if (f.dietMode === want && (!autoOn || f.splitDay)) return f;
      return { ...f, dietMode: want, ...(autoOn ? { splitDay: true } : {}) };
    });
  }, [form.workplaceId, form.start, form.end, form.dayType, workplaces]);

  useEffect(() => {
    setForm((f) => {
      if (f.paradaTouched || f.dayType) return f;
      const m = resolveParada({ ...f, parada: "auto" }, parades);
      return f.parada === m ? f : { ...f, parada: m };
    });
  }, [form.workplaceId, form.date, form.festiu, form.dayType, parades]);

  const initWp = useRef(false);
  useEffect(() => {
    if (loading || initWp.current) return;
    initWp.current = true;
    const last = [...entries].filter((e) => e.workplaceId).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (last) handleWorkplaceChange(last.workplaceId);
  }, [loading]);

  const setTicket = (i, k, v) => setForm((f) => ({ ...f, tickets: f.tickets.map((tk, j) => (j === i ? { ...tk, [k]: v } : tk)) }));
  const addTicket = () => setForm((f) => ({ ...f, tickets: [...f.tickets, { concept: "", amount: "", desc: "" }] }));
  const removeTicket = (i) => setForm((f) => ({ ...f, tickets: f.tickets.filter((_, j) => j !== i) }));

  function startEdit(entry) {
    const e = normalizeEntry(entry);
    const wp = workplaces.find((w) => w.id === e.workplaceId);
    let ms = timeToMinutes(e.start), me = timeToMinutes(e.end);
    if (me <= ms) me += 1440;
    setForm({ ...emptyForm(e.date, festius), ...e, dietMode: e.dietMode === "auto" ? resolveDiet(e, wp, (me - ms) / 60) : e.dietMode, parada: !e.parada || e.parada === "auto" ? resolveParada({ ...e, parada: "auto" }, parades) : e.parada, ticketsOn: e.tickets.length > 0, timesTouched: true, dietTouched: true, paradaTouched: true });
    setTab("fitxatge");
  }

  function resetForm(wpId) {
    const date = form.date || todayStr();
    const wId = typeof wpId === "string" ? wpId : form.workplaceId;
    const sc = getStandardSchedule(date, workplaces.find((w) => w.id === wId), reducedDays);
    setForm({ ...emptyForm(date, festius, reducedDays), workplaceId: wId, start: sc.start, end: sc.end, splitDay: sc.split });
  }


  async function submitEntry(force) {
    if (entries.some((e) => e.date === form.date && e.id !== form.id) && force !== true) { setDupConfirm(true); return; }
    setDupConfirm(false);
    const { timesTouched, dietTouched, paradaTouched, ticketsOn, ...clean } = form;
    const rec = { ...clean, id: form.id || Date.now().toString(), tickets: ticketsOn ? form.tickets.filter((tk) => tk.concept || tk.amount || tk.desc) : [] };
    const next = [...entries.filter((e) => e.date !== rec.date && e.id !== rec.id), rec].sort((a, b) => a.date.localeCompare(b.date));
    setEntries(next);
    await persist({ entries: next });
    resetForm();
  }

  const cfgNow = () => ({ settingsVersions, workplaces, parades, festius, reducedDays, ots, retencioPercent, monthlyBaseOverrides });

  async function applyCfg(s) {
    skipUndo.current = true;
    setSettingsVersions(s.settingsVersions); setWorkplaces(s.workplaces); setParades(s.parades); setFestius(s.festius);
    setReducedDays(s.reducedDays || []); setOts(s.ots); setRetencioPercent(s.retencioPercent); setMonthlyBaseOverrides(s.monthlyBaseOverrides);
    await persist({ ...s, reducedDays: s.reducedDays || [] });
  }

  async function undoConfig() {
    if (!undoStack.length) return;
    const s = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, cfgNow()]);
    setUndoStack(undoStack.slice(0, -1));
    await applyCfg(s);
  }

  async function redoConfig() {
    if (!redoStack.length) return;
    const s = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, cfgNow()]);
    setRedoStack(redoStack.slice(0, -1));
    await applyCfg(s);
  }

  async function updateParada(id, k, v) {
    const next = parades.map((p) => (p.id === id ? { ...p, [k]: v } : p));
    setParades(next);
    await persist({ parades: next });
  }

  async function addReduced() {
    if (!reducedForm.date || reducedForm.start >= reducedForm.end) return;
    const next = [...reducedDays.filter((r) => r.date !== reducedForm.date), { id: Date.now().toString(), ...reducedForm }].sort((a, b) => a.date.localeCompare(b.date));
    setReducedDays(next);
    await persist({ reducedDays: next });
    setReducedForm((f) => ({ ...f, date: "" }));
  }

  async function deleteReduced(id) {
    const next = reducedDays.filter((r) => r.id !== id);
    setReducedDays(next);
    await persist({ reducedDays: next });
  }

  async function toggleTicketPaid(entryId, idx) {
    const next = entries.map((e) => (e.id === entryId ? { ...e, tickets: e.tickets.map((tk, i) => (i === idx ? { ...tk, paid: !tk.paid } : tk)) } : e));
    setEntries(next);
    await persist({ entries: next });
  }

  async function addOT() {
    const v = otInput.trim();
    if (!v || ots.includes(v)) return;
    const next = [...ots, v];
    setOts(next);
    setOtInput("");
    await persist({ ots: next });
  }

  async function deleteOT(o) {
    const next = ots.filter((x) => x !== o);
    setOts(next);
    await persist({ ots: next });
  }

  async function deleteEntry(id) {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    await persist({ entries: next });
    setSelectedDay(null);
  }

  async function updateVersions(next) {
    setSettingsVersions(next);
    await persist({ settingsVersions: next });
  }

  async function updateRetencio(v) {
    setRetencioPercent(v);
    await persist({ retencioPercent: v });
  }

  async function updateLang(v) {
    setLang(v);
    await persist({ lang: v });
  }

  async function addWorkplace() {
    if (!wpForm.name.trim()) return;
    const next = [...workplaces, { id: Date.now().toString(), name: wpForm.name.trim(), km: Number(wpForm.km) || 0, autoDieta: wpForm.autoDieta }];
    setWorkplaces(next);
    await persist({ workplaces: next });
    setWpForm({ name: "", km: "", autoDieta: false });
  }

  async function deleteWorkplace(id) {
    const next = workplaces.filter((w) => w.id !== id);
    setWorkplaces(next);
    await persist({ workplaces: next });
  }

  async function toggleWorkplaceAutoDieta(id) {
    const next = workplaces.map((w) => (w.id === id ? { ...w, autoDieta: !w.autoDieta } : w));
    setWorkplaces(next);
    await persist({ workplaces: next });
  }

  async function updateWorkplaceKm(id, v) {
    const next = workplaces.map((w) => (w.id === id ? { ...w, km: v === "" ? "" : Number(v) } : w));
    setWorkplaces(next);
    await persist({ workplaces: next });
  }

  async function toggleWorkplacePartit(id) {
    const next = workplaces.map((w) => (w.id === id ? { ...w, horari: isPartit(w) ? "normal" : "partit" } : w));
    setWorkplaces(next);
    await persist({ workplaces: next });
  }

  async function addParada() {
    if (!paradaForm.workplaceId || !paradaForm.start || !paradaForm.end || paradaForm.start > paradaForm.end) return;
    const next = [...parades, { id: Date.now().toString(), ...paradaForm }].sort((a, b) => a.start.localeCompare(b.start));
    setParades(next);
    await persist({ parades: next });
    setParadaForm({ workplaceId: "", start: "", end: "" });
  }

  async function deleteParada(id) {
    const next = parades.filter((p) => p.id !== id);
    setParades(next);
    await persist({ parades: next });
  }

  async function addFestiu() {
    if (!festiuInput || festius.includes(festiuInput)) return;
    const next = [...festius, festiuInput].sort();
    setFestius(next);
    await persist({ festius: next });
    setFestiuInput("");
  }

  async function removeFestiu(dateStr) {
    const next = festius.filter((f) => f !== dateStr);
    setFestius(next);
    await persist({ festius: next });
  }

  async function setBaseOverride(monthStr, value) {
    const next = { ...monthlyBaseOverrides };
    if (value === "" || value === null) delete next[monthStr];
    else next[monthStr] = Number(value);
    setMonthlyBaseOverrides(next);
    await persist({ monthlyBaseOverrides: next });
  }

  function getBaseForMonth(monthStr) {
    if (monthlyBaseOverrides[monthStr] !== undefined) return monthlyBaseOverrides[monthStr];
    return getSettingsForDate(monthStr + "-01", settingsVersions).souBase;
  }

  function summarizeMonth(monthStr) {
    const mEntries = entries.filter((e) => e.date.startsWith(monthStr));
    let normalHours = 0, extraHours = 0, extraHoursAmount = 0, kmTotal = 0, kmAmount = 0, dietAmount = 0, paradaAmount = 0, nocturnAmount = 0, nocturnHours = 0, ticketsAmount = 0;
    mEntries.forEach((e) => {
      const c = computeEntry(e, settingsVersions, workplaces, festius, parades, reducedDays);
      normalHours += c.normalHours;
      extraHours += c.extraHours;
      extraHoursAmount += c.extraHoursAmount;
      kmTotal += c.km;
      kmAmount += c.kmAmount;
      dietAmount += c.dietAmount;
      paradaAmount += c.paradaAmount;
      nocturnAmount += c.nocturnAmount; nocturnHours += c.nightH; ticketsAmount += c.ticketsAmount;
    });
    const totalExtra = extraHoursAmount + kmAmount + dietAmount + paradaAmount + nocturnAmount;
    const base = getBaseForMonth(monthStr);
    const totalBrut = base + totalExtra;
    const totalNet = totalBrut * (1 - retencioPercent / 100);
    return { normalHours, extraHours, extraHoursAmount, kmTotal, kmAmount, dietAmount, paradaAmount, nocturnAmount, nocturnHours, ticketsAmount, totalExtra, base, totalBrut, totalNet, count: mEntries.length };
  }

  function summarizeRange(startStr, endStr) {
    if (!startStr || !endStr || startStr > endStr) return null;
    const rEntries = entries.filter((e) => e.date >= startStr && e.date <= endStr);
    let normalHours = 0, extraHours = 0, extraHoursAmount = 0;
    let kmTotal = 0, kmAmount = 0, nocturnAmount = 0, nocturnHours = 0, ticketsAmount = 0;
    let mitjaCount = 0, mitjaAmount = 0, completaCount = 0, completaAmount = 0;
    let paradaNormalCount = 0, paradaNormalAmount = 0, paradaFestiuCount = 0, paradaFestiuAmount = 0;
    rEntries.forEach((e) => {
      const c = computeEntry(e, settingsVersions, workplaces, festius, parades, reducedDays);
      normalHours += c.normalHours;
      extraHours += c.extraHours;
      extraHoursAmount += c.extraHoursAmount;
      kmTotal += c.km;
      kmAmount += c.kmAmount;
      if (c.dietResolved === "mitja") { mitjaCount++; mitjaAmount += c.dietAmount; }
      if (c.dietResolved === "completa") { completaCount++; completaAmount += c.dietAmount; }
      if (c.paradaMode === "normal") { paradaNormalCount++; paradaNormalAmount += c.paradaAmount; }
      if (c.paradaMode === "festiu") { paradaFestiuCount++; paradaFestiuAmount += c.paradaAmount; }
      nocturnAmount += c.nocturnAmount; nocturnHours += c.nightH; ticketsAmount += c.ticketsAmount;
    });
    const dietAmount = mitjaAmount + completaAmount;
    const paradaAmount = paradaNormalAmount + paradaFestiuAmount;
    const totalExtra = extraHoursAmount + kmAmount + dietAmount + paradaAmount + nocturnAmount;
    const months = monthsBetween(startStr, endStr);
    const baseTotal = months.reduce((sum, m) => {
      const [y, mm] = m.split("-").map(Number);
      const monthStart = `${m}-01`;
      const daysInMonth = new Date(y, mm, 0).getDate();
      const monthEnd = `${m}-${String(daysInMonth).padStart(2, "0")}`;
      const overlapStart = startStr > monthStart ? startStr : monthStart;
      const overlapEnd = endStr < monthEnd ? endStr : monthEnd;
      const daysOverlap = Math.round((new Date(overlapEnd + "T00:00:00") - new Date(overlapStart + "T00:00:00")) / 86400000) + 1;
      const proportion = daysOverlap / daysInMonth;
      return sum + getBaseForMonth(m) * proportion;
    }, 0);
    const totalBrut = baseTotal + totalExtra;
    const totalNet = totalBrut * (1 - retencioPercent / 100);
    return {
      count: rEntries.length, normalHours, extraHours, extraHoursAmount,
      kmTotal, kmAmount, mitjaCount, mitjaAmount, completaCount, completaAmount,
      paradaNormalCount, paradaNormalAmount, paradaFestiuCount, paradaFestiuAmount,
      nocturnAmount, nocturnHours, ticketsAmount, totalExtra, months, baseTotal, totalBrut, totalNet,
    };
  }

  const rangeSummary = useMemo(() => summarizeRange(rangeStart, rangeEnd), [entries, settingsVersions, workplaces, festius, parades, reducedDays, monthlyBaseOverrides, retencioPercent, rangeStart, rangeEnd]);

  const monthSummary = useMemo(() => summarizeMonth(month), [entries, settingsVersions, workplaces, festius, parades, reducedDays, monthlyBaseOverrides, retencioPercent, month]);



  const annualSummary = useMemo(() => {
    const year = month.slice(0, 4);
    const currentMonthNum = Number(month.slice(5, 7));
    let totalBrut = 0, totalNet = 0, totalExtra = 0, totalBase = 0;
    for (let m = 1; m <= currentMonthNum; m++) {
      const ms = `${year}-${String(m).padStart(2, "0")}`;
      const s = summarizeMonth(ms);
      totalBrut += s.totalBrut;
      totalNet += s.totalNet;
      totalExtra += s.totalExtra;
      totalBase += s.base;
    }
    let projectedBaseFullYear = 0;
    for (let m = 1; m <= 12; m++) {
      projectedBaseFullYear += getBaseForMonth(`${year}-${String(m).padStart(2, "0")}`);
    }
    const avgExtraPerMonth = currentMonthNum > 0 ? totalExtra / currentMonthNum : 0;
    const projectedExtraFullYear = avgExtraPerMonth * 12;
    const projectedBrut = projectedBaseFullYear + projectedExtraFullYear;
    const projectedNet = projectedBrut * (1 - retencioPercent / 100);
    return { totalBrut, totalNet, totalExtra, totalBase, year, throughMonth: currentMonthNum, projectedBrut, projectedNet };
  }, [entries, settingsVersions, workplaces, festius, parades, reducedDays, monthlyBaseOverrides, retencioPercent, month]);

  const monthEntries = useMemo(
    () => entries.filter((e) => e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date)),
    [entries, month]
  );

  const calendarCells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push(dateStr);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  const otOptions = useMemo(() => {
    const seen = [];
    [...entries].sort((a, b) => b.date.localeCompare(a.date)).forEach((e) => { if (e.ot && ots.includes(e.ot) && !seen.includes(e.ot)) seen.push(e.ot); });
    return [...seen, ...ots.filter((o) => !seen.includes(o))];
  }, [entries, ots]);

  async function loadExcelJS() {
    try { const mod = await import("exceljs"); return mod.default || mod; } catch (err) { return null; }
  }

  function download(buf, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function exportExcel() {
    if (!rangeSummary) { setExportMsg(tr("invalid_range")); return; }
    const inRange = entries.filter((e) => e.date >= rangeStart && e.date <= rangeEnd);
    if (!inRange.length) { setExportMsg(tr("no_entries_range")); return; }
    const ExcelJS = await loadExcelJS();
    if (!ExcelJS) { setExportMsg("Excel: només disponible a la versió de Netlify."); return; }
    setExportMsg("");
    const es = lang === "es";
    const pad = (n) => String(n).padStart(2, "0");
    const days = [];
    const cur = new Date(rangeStart + "T00:00:00");
    for (let i = 0; i < 800; i++) {
      const ds = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
      if (ds > rangeEnd) break;
      days.push(ds);
      cur.setDate(cur.getDate() + 1);
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(es ? "Fichajes" : "Fitxatges");
    const heads = es ? ["Fecha", "Horas", "Horas extra", "Ubicación", "Km", "Dieta", "Plus", "Horas nocturnas", "OT", "Descripción"] : ["Data", "Hores", "Hores extra", "Ubicació", "Km", "Dieta", "Plus", "Hores nocturnes", "OT", "Descripció"];
    ws.columns = heads.map((h, i) => ({ header: h, key: "c" + i, width: [12, 9, 11, 18, 8, 11, 11, 15, 14, 44][i] }));
    const thin = { style: "thin", color: { argb: "FFD1D5DB" } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    const holRows = new Set();
    days.forEach((ds) => {
      const [y, m, d] = ds.split("-").map(Number);
      const list = inRange.filter((e) => e.date === ds);
      const hol = isHolidayDate(ds, festius) || list.some((e) => e.festiu);
      const dateCell = new Date(Date.UTC(y, m - 1, d));
      if (!list.length) { const r = ws.addRow([dateCell]); if (hol) holRows.add(r.number); return; }
      list.forEach((e) => {
        const c = computeEntry(e, settingsVersions, workplaces, festius, parades, reducedDays);
        const r = ws.addRow([dateCell, e.dayType ? "" : Number(c.normalHours.toFixed(2)), e.dayType ? "" : Number(c.extraHours.toFixed(2)), e.dayType ? tr("daytype_" + e.dayType) : c.workplaceName, c.km, c.dietAmount, c.paradaAmount, Number(c.nightH.toFixed(2)), e.ot || "", e.notes || ""]);
        if (hol) holRows.add(r.number);
      });
    });
    const last = ws.rowCount;
    const tot = ws.addRow(["Total"]);
    Object.entries({ B: 2, C: 3, E: 5, F: 6, G: 7, H: 8 }).forEach(([col, idx]) => {
      let v = 0;
      for (let r = 2; r <= last; r++) v += Number(ws.getRow(r).getCell(idx).value) || 0;
      tot.getCell(idx).value = { formula: `SUBTOTAL(109,${col}2:${col}${last})`, result: Number(v.toFixed(2)) };
    });
    ws.eachRow((row, rn) => row.eachCell({ includeEmpty: true }, (cell, cn) => {
      cell.border = border;
      if (rn === 1) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBE0936" } }; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.alignment = { horizontal: "center" }; }
      else if (rn === last + 1) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } }; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; }
      else cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: holRows.has(rn) ? "FFFFE0C2" : rn % 2 ? "FFFBE9ED" : "FFFFFFFF" } };
      if (rn > 1 && cn === 1 && rn <= last) cell.numFmt = "dd/mm/yyyy";
      if (rn > 1 && [6, 7].includes(cn)) cell.numFmt = '#,##0.00 "€"';
    }));
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: `J${last}` };
    download(await wb.xlsx.writeBuffer(), `${es ? "fichajes" : "fitxatges"}-${rangeStart}_${rangeEnd}.xlsx`);
  }

  async function exportBackup() {
    const ExcelJS = await loadExcelJS();
    if (!ExcelJS) { setExportMsg("Excel: només disponible a la versió de Netlify."); return; }
    const wb = new ExcelJS.Workbook();
    const sheet = (name, keys, rows) => {
      const ws = wb.addWorksheet(name);
      ws.addRow(keys);
      rows.forEach((r) => ws.addRow(keys.map((k) => (r[k] === undefined || r[k] === null ? "" : r[k]))));
      ws.getRow(1).font = { bold: true };
      keys.forEach((_, i) => { ws.getColumn(i + 1).width = 16; });
    };
    sheet("Fitxatges", ["id", "date", "workplaceId", "start", "end", "splitDay", "festiu", "kmMode", "kmManual", "dietMode", "parada", "nocturnMode", "ot", "notes", "dayType"], entries);
    sheet("Tiquets", ["entryId", "date", "concept", "amount", "desc", "paid"], entries.flatMap((e) => (e.tickets || []).map((tk) => ({ entryId: e.id, date: e.date, ...tk }))));
    sheet("OT", ["name"], ots.map((name) => ({ name })));
    sheet("Preus", ["id", "effectiveFrom", "souBase", "preuHoraExtra", "preuKm", "mitjaDieta", "dietaCompleta", "plusParadaNormal", "plusParadaFestiu", "plusNocturnitat"], settingsVersions);
    sheet("Llocs", ["id", "name", "km", "autoDieta", "horari"], workplaces.map((w) => ({ ...w, horari: isPartit(w) ? "partit" : "normal" })));
    sheet("Reduides", ["id", "date", "start", "end"], reducedDays);
    sheet("Parades", ["id", "workplaceId", "start", "end"], parades);
    sheet("Festius", ["date"], festius.map((d) => ({ date: d })));
    sheet("SouMensual", ["month", "souBase"], Object.entries(monthlyBaseOverrides).map(([month, souBase]) => ({ month, souBase })));
    sheet("Config", ["key", "value"], [{ key: "appVersion", value: "1.3" }, { key: "exportedAt", value: todayStr() }, { key: "retencioPercent", value: retencioPercent }, { key: "lang", value: lang }]);
    download(await wb.xlsx.writeBuffer(), `fitxatge-copia-completa-${todayStr()}.xlsx`);
  }

  async function importBackup(file) {
    if (!file) return;
    const ExcelJS = await loadExcelJS();
    if (!ExcelJS) { setImportMsg("Excel: només disponible a la versió de Netlify."); return; }
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));
      const tm = (v) => {
        if (typeof v === "number" && v < 1) { const mm = Math.round(v * 1440); return `${String(Math.floor(mm / 60) % 24).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`; }
        if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
        const s = String(v ?? ""); return (s.length === 4 ? "0" + s : s).slice(0, 5);
      };
      const bool = (v) => v === true || v === 1 || /^(true|1|si|sí|yes)$/i.test(String(v));
      const num = (v) => (v === "" || v == null ? 0 : Number(v) || 0);
      const read = (name) => {
        const ws = wb.getWorksheet(name);
        const rows = [];
        if (!ws) return rows;
        let keys = null;
        ws.eachRow((row) => {
          const vals = row.values.slice(1);
          if (!keys) { keys = vals.map((v) => String(v ?? "")); return; }
          const o = {};
          keys.forEach((k, i) => { let v = vals[i]; if (v && typeof v === "object" && !(v instanceof Date) && v.result !== undefined) v = v.result; o[k] = v === undefined || v === null ? "" : v; });
          rows.push(o);
        });
        return rows;
      };
      const idMap = {};
      const wps = [...workplaces];
      read("Llocs").forEach((w) => {
        const id = String(w.id), name = String(w.name);
        const found = wps.find((x) => x.id === id) || wps.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (found) idMap[id] = found.id;
        else { wps.push({ id, name, km: num(w.km), autoDieta: bool(w.autoDieta), horari: w.horari === "partit" ? "partit" : "normal" }); idMap[id] = id; }
      });
      const sv = [...settingsVersions];
      read("Preus").forEach((p) => {
        const v = { id: String(p.id || Date.now() + Math.random()), effectiveFrom: iso(p.effectiveFrom), souBase: num(p.souBase), preuHoraExtra: num(p.preuHoraExtra), preuKm: num(p.preuKm), mitjaDieta: num(p.mitjaDieta), dietaCompleta: num(p.dietaCompleta), plusParadaNormal: num(p.plusParadaNormal), plusParadaFestiu: num(p.plusParadaFestiu), plusNocturnitat: num(p.plusNocturnitat) };
        const i = sv.findIndex((x) => x.effectiveFrom === v.effectiveFrom);
        if (i < 0) sv.push(v); else if (!sv[i].souBase && !sv[i].preuHoraExtra) sv[i] = { ...v, id: sv[i].id };
      });
      const pd = [...parades];
      read("Parades").forEach((p) => {
        const wid = idMap[String(p.workplaceId)] ?? String(p.workplaceId), start = iso(p.start), end = iso(p.end);
        if (!pd.some((x) => x.workplaceId === wid && x.start === start && x.end === end)) pd.push({ id: String(p.id || Date.now() + Math.random()), workplaceId: wid, start, end });
      });
      const fs = [...new Set([...festius, ...read("Festius").map((r) => iso(r.date)).filter((d) => d.length === 10)])].sort();
      const rdl = [...reducedDays];
      read("Reduides").forEach((r) => { const d = iso(r.date); if (d.length === 10 && !rdl.some((x) => x.date === d)) rdl.push({ id: String(r.id || Date.now() + Math.random()), date: d, start: tm(r.start) || "08:00", end: tm(r.end) || "14:00" }); });
      const mo = { ...monthlyBaseOverrides };
      read("SouMensual").forEach((r) => { if (r.month && mo[r.month] === undefined) mo[r.month] = num(r.souBase); });
      const cfgRet = read("Config").find((r) => r.key === "retencioPercent");
      const ret = cfgRet && retencioPercent === 15 && cfgRet.value !== "" ? num(cfgRet.value) : retencioPercent;
      const ticketsById = {};
      read("Tiquets").forEach((r) => { (ticketsById[String(r.entryId)] = ticketsById[String(r.entryId)] || []).push({ concept: String(r.concept || ""), amount: r.amount === "" ? "" : num(r.amount), desc: String(r.desc || ""), paid: bool(r.paid) }); });
      const have = new Set(entries.map((e) => e.date));
      let added = 0, skipped = 0;
      const fresh = [];
      read("Fitxatges").forEach((r, idx) => {
        const date = iso(r.date);
        if (date.length !== 10) return;
        if (have.has(date)) { skipped++; return; }
        have.add(date);
        const id = String(r.id || Date.now() + "-" + idx);
        const e = normalizeEntry({
          id, date, workplaceId: idMap[String(r.workplaceId)] ?? String(r.workplaceId || ""), start: tm(r.start) || "07:00", end: tm(r.end) || "15:00",
          splitDay: bool(r.splitDay), festiu: r.festiu === "" ? isHolidayDate(date, fs) : bool(r.festiu), kmMode: r.kmMode === "manual" ? "manual" : "auto", kmManual: num(r.kmManual),
          dietMode: String(r.dietMode || "none"), parada: String(r.parada || "none"), nocturnMode: r.nocturnMode === "off" ? "off" : "auto", ot: String(r.ot || ""), notes: String(r.notes || ""), dayType: String(r.dayType || ""),
          ...(ticketsById[id] ? { tickets: ticketsById[id] } : { ticketConcept: r.ticketConcept, ticketAmount: r.ticketAmount, ticketDesc: r.ticketDesc }),
        });
        const wp = wps.find((w) => w.id === e.workplaceId);
        let ms = timeToMinutes(e.start), me = timeToMinutes(e.end);
        if (me <= ms) me += 1440;
        if (e.dietMode === "auto") e.dietMode = resolveDiet(e, wp, (me - ms) / 60);
        if (e.parada === "auto") e.parada = resolveParada(e, pd);
        fresh.push(e);
        added++;
      });
      const allEntries = [...entries, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
      const otList = [...new Set([...ots, ...read("OT").map((r) => String(r.name)).filter(Boolean), ...fresh.map((e) => e.ot).filter(Boolean)])];
      setEntries(allEntries); setWorkplaces(wps); setSettingsVersions(sv); setParades(pd); setFestius(fs); setMonthlyBaseOverrides(mo); setOts(otList); setRetencioPercent(ret); setReducedDays(rdl);
      await persist({ entries: allEntries, workplaces: wps, settingsVersions: sv, parades: pd, festius: fs, monthlyBaseOverrides: mo, ots: otList, retencioPercent: ret, reducedDays: rdl });
      setImportMsg(tr("import_ok", added, skipped));
    } catch (err) {
      setImportMsg(tr("import_err"));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-500 text-sm">Carregant...</div>
      </div>
    );
  }

  const selWp = workplaces.find((w) => w.id === form.workplaceId);
  const kmValue = form.kmMode === "manual" ? form.kmManual : selWp ? selWp.km : 0;
  const formNight = nightHours(form.start, form.end);
  const formParada = resolveParada(form, parades);
  const rangeTickets = rangeSummary ? entries.filter((e) => e.date >= rangeStart && e.date <= rangeEnd).flatMap((e) => (e.tickets || []).map((tk, idx) => ({ date: e.date, entryId: e.id, idx, ...tk }))) : [];
  const rangeDayTypes = ["descans", "vacances", "baixa", "personal", "altres"].map((k) => ({ k, n: rangeSummary ? entries.filter((e) => e.date >= rangeStart && e.date <= rangeEnd && e.dayType === k).length : 0 }));
  const selectedEntry = selectedDay ? entries.find((e) => e.date === selectedDay) : null;
  const selectedComputed = selectedEntry ? computeEntry(selectedEntry, settingsVersions, workplaces, festius, parades, reducedDays) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-[#e21a4c]" />
          <h1 className="text-lg font-semibold tracking-tight">Fitxatge Manserva</h1>
        </div>
        <nav className="flex gap-1 mt-3 overflow-x-auto">
          {[
            { id: "fitxatge", label: tr("nav_fitxatge"), icon: CalendarDays },
            { id: "calendari", label: tr("nav_calendari"), icon: CalendarRange },
            { id: "resum", label: tr("nav_resum"), icon: ListChecks },
            { id: "config", label: tr("nav_config"), icon: SettingsIcon },
          ].map((tabItem) => (
            <button
              key={tabItem.id}
              onClick={() => setTab(tabItem.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition shrink-0 ${
                tab === tabItem.id ? "bg-[#be0936] text-white" : "bg-slate-800 text-slate-400"
              }`}
            >
              <tabItem.icon className="w-3.5 h-3.5" />
              {tabItem.label}
            </button>
          ))}
        </nav>
      </header>

      {saveError && (
        <div className="bg-amber-950/50 border-b border-amber-800 text-amber-300 text-xs px-4 py-2 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {tr("save_error")}
        </div>
      )}

      <main className="p-4 max-w-2xl mx-auto pb-16">
        {tab === "fitxatge" && (
          <div className="space-y-4">
            <section className={cardCls}>
              <h2 className="font-semibold text-slate-100 mb-3 flex items-center gap-2">
                {form.id ? <Pencil className="w-4 h-4 text-[#e21a4c]" /> : <Plus className="w-4 h-4 text-[#e21a4c]" />}
                {form.id ? tr("edit_entry") : tr("new_entry")}
              </h2>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <label className={`${labelCls} col-span-2`}>
                  {tr("label_date")}
                  <input type="date" value={form.date} onChange={(e) => handleDateChange(e.target.value)} className={inputCls} />
                </label>
                <label className={labelCls}>
                  {tr("label_start")}
                  <select value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value, timesTouched: true }))} className={inputCls}>
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className={labelCls}>
                  {tr("label_end")}
                  <select value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value, timesTouched: true }))} className={inputCls}>
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                {(() => { const sc = getStandardSchedule(form.date, selWp, reducedDays); return tr("schedule_note", sc.start, sc.end, sc.hours); })()}
              </p>


              <div className="flex flex-col gap-2 mb-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={form.splitDay} onChange={(e) => setForm((f) => ({ ...f, splitDay: e.target.checked }))} className="rounded" />
                  <Coffee className="w-3.5 h-3.5 text-slate-500" />
                  {tr("split_day")}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={form.festiu} onChange={(e) => setForm((f) => ({ ...f, festiu: e.target.checked }))} className="rounded" />
                  <CalendarDays className="w-3.5 h-3.5 text-slate-500" />
                  {tr("holiday_checkbox")}
                </label>
              </div>

              <div className="mb-3">
                <label className={`${labelCls} flex items-center gap-1.5 mb-1`}>
                  <MapPin className="w-3.5 h-3.5" /> {tr("label_workplace")}
                </label>
                <div className={workplaces.length > 3 ? "flex flex-wrap gap-2" : "flex gap-2"}>
                  {[...workplaces, { id: "", name: tr("other_place") }].map((w) => (
                    <button
                      key={w.id || "none"}
                      type="button"
                      onClick={() => handleWorkplaceChange(w.id)}
                      className={`flex-1 ${workplaces.length > 3 ? "min-w-[30%]" : ""} rounded-lg py-1.5 text-xs font-medium border ${
                        form.workplaceId === w.id ? "bg-[#be0936] border-[#be0936] text-white" : "bg-slate-800 border-slate-700 text-slate-300"
                      }`}
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <label className={`${labelCls} flex items-center gap-1.5 mb-1`}>
                  <Car className="w-3.5 h-3.5" /> {tr("label_km")}
                </label>
                <input type="number" step="0.1" value={kmValue} onChange={(e) => setForm((f) => ({ ...f, kmMode: "manual", kmManual: e.target.value }))} className={inputCls} />
                {form.kmMode === "manual" && selWp && (
                  <button type="button" onClick={() => setForm((f) => ({ ...f, kmMode: "auto" }))} className="text-xs text-[#e21a4c] mt-1">{tr("km_reset", selWp.km)}</button>
                )}
              </div>

              <div className="mb-3">
                <label className={`${labelCls} flex items-center gap-1.5 mb-1`}>
                  <Utensils className="w-3.5 h-3.5" /> {tr("label_diet")}
                </label>
                <div className="flex gap-2">
                  {[
                    ["none", tr("diet_none")],
                    ["mitja", `${tr("diet_short_mitja")} (${fmt(getSettingsForDate(form.date, settingsVersions).mitjaDieta)}€)`],
                    ["completa", `${tr("diet_short_completa")} (${fmt(getSettingsForDate(form.date, settingsVersions).dietaCompleta)}€)`],
                  ].map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, dietMode: val, dietTouched: true }))}
                      className={`flex-1 rounded-lg py-1.5 text-xs font-medium border ${
                        form.dietMode === val ? "bg-[#be0936] border-[#be0936] text-white" : "bg-slate-800 border-slate-700 text-slate-300"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <label className={`${labelCls} flex items-center gap-1.5 mb-1`}>
                  <Euro className="w-3.5 h-3.5" /> {tr("label_parada")}
                </label>
                <div className="flex gap-2">
                  {[
                    ["none", tr("parada_none")],
                    ["normal", `${tr("parada_normal")} (${fmt(getSettingsForDate(form.date, settingsVersions).plusParadaNormal)}€)`],
                    ["festiu", `${tr("parada_festiu")} (${fmt(getSettingsForDate(form.date, settingsVersions).plusParadaFestiu)}€)`],
                  ].map(([val, lbl]) => (
                    <button
                      key={val}
                      onClick={() => setForm((f) => ({ ...f, parada: val, paradaTouched: true }))}
                      className={`flex-1 rounded-lg py-1.5 text-xs font-medium border ${
                        form.parada === val ? "bg-[#be0936] border-[#be0936] text-white" : "bg-slate-800 border-slate-700 text-slate-300"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-200 mb-3">
                <input type="checkbox" disabled={formNight === 0} checked={formNight > 0 && form.nocturnMode !== "off"} onChange={(e) => setForm((f) => ({ ...f, nocturnMode: e.target.checked ? "auto" : "off" }))} className="rounded" />
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                {tr("nocturn_label")} ({fmt(formNight)} h)
              </label>

              <div className="mb-3">
                <label className={labelCls}>{tr("label_ot")}</label>
                <select value={form.ot || ""} onChange={(e) => setForm((f) => ({ ...f, ot: e.target.value }))} className={inputCls}>
                  <option value="">—</option>
                  {(form.ot && !otOptions.includes(form.ot) ? [form.ot, ...otOptions] : otOptions).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              <div className="mb-4">
                <label className={labelCls}>{tr("label_notes")}</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className={inputCls}
                  placeholder={tr("notes_placeholder")}
                />
              </div>

              <div className="mb-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={!!form.ticketsOn} onChange={(e) => setForm((f) => ({ ...f, ticketsOn: e.target.checked, tickets: e.target.checked && !f.tickets.length ? [{ concept: "", amount: "", desc: "" }] : f.tickets }))} className="rounded" />
                  {tr("tickets_title")}
                </label>
                {form.ticketsOn && (
                  <div className="mt-2 space-y-2">
                    {form.tickets.map((tk, i) => (
                      <div key={i} className="grid grid-cols-3 gap-2 rounded-lg border border-slate-800 p-2">
                        <input className={`${inputCls} col-span-2 !mt-0`} placeholder={tr("ticket_concept")} value={tk.concept} onChange={(e) => setTicket(i, "concept", e.target.value)} />
                        <input type="number" step="0.01" className={`${inputCls} !mt-0`} placeholder="€" value={tk.amount} onChange={(e) => setTicket(i, "amount", e.target.value)} />
                        <input className={`${inputCls} col-span-2 !mt-0`} placeholder={tr("ticket_desc")} value={tk.desc} onChange={(e) => setTicket(i, "desc", e.target.value)} />
                        <button type="button" onClick={() => removeTicket(i)} className="text-red-400 text-xs">{tr("btn_delete")}</button>
                      </div>
                    ))}
                    <button type="button" onClick={addTicket} className="text-xs text-[#e21a4c]">+ {tr("add_ticket")}</button>
                  </div>
                )}
              </div>

              <div className="mb-4">
                <label className={`${labelCls} mb-1 block`}>{tr("daytype_title")}</label>
                <div className="flex flex-wrap gap-2">
                  {["", "descans", "vacances", "baixa", "personal", "altres"].map((k) => (
                    <button key={k || "work"} type="button" onClick={() => setForm((f) => ({ ...f, dayType: k, ...(k ? { dietMode: "none", dietTouched: true } : { dietTouched: false }) }))} className={`flex-1 min-w-[30%] rounded-lg py-1.5 text-xs font-medium border ${form.dayType === k ? "bg-[#be0936] border-[#be0936] text-white" : "bg-slate-800 border-slate-700 text-slate-300"}`}>
                      {k ? tr("daytype_" + k) : tr("daytype_work")}
                    </button>
                  ))}
                </div>
              </div>

              {dupConfirm && (
                <div className="mb-3 rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-200">
                  {tr("dup_warn")}
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={() => submitEntry(true)} className="flex-1 bg-[#be0936] text-white rounded-lg py-1.5">{tr("dup_accept")}</button>
                    <button type="button" onClick={() => setDupConfirm(false)} className="flex-1 bg-slate-800 text-slate-300 rounded-lg py-1.5">{tr("btn_cancel")}</button>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => submitEntry()} className="flex-1 bg-[#be0936] text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-1.5">
                  <Check className="w-4 h-4" />
                  {form.id ? tr("btn_update") : tr("btn_add_entry")}
                </button>
                {form.id && (
                  <button onClick={() => resetForm()} className="px-3 bg-slate-800 text-slate-300 rounded-lg text-sm flex items-center gap-1">
                    <X className="w-4 h-4" /> {tr("btn_cancel")}
                  </button>
                )}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-slate-500 mb-2 px-1">{tr("recent_entries")}</h3>
              <div className="space-y-2">
                {entries.slice().reverse().slice(0, 15).map((e) => {
                  const c = computeEntry(e, settingsVersions, workplaces, festius, parades, reducedDays);
                  return (
                    <div key={e.id} className="bg-slate-900 rounded-lg border border-slate-800 p-3 flex items-start justify-between gap-2">
                      <div className="text-sm">
                        <div className="font-medium text-slate-100 flex items-center gap-2">
                          {e.date}
                          {e.dayType && <span className="text-xs text-amber-300">{tr("daytype_" + e.dayType)}</span>}
                          {c.holiday && <span className="text-xs bg-orange-950 text-orange-300 px-1.5 py-0.5 rounded">{tr("badge_festiu")}</span>}
                        </div>
                        <div className="text-slate-400 text-xs mt-0.5">
                          {e.start}–{e.end} · {c.workplaceName} · {fmt(c.totalHours)}h
                          {c.extraHours > 0 && <span className="text-[#e21a4c] font-medium"> (+{fmt(c.extraHours)}h {tr("extra_suffix")})</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {tr("extra_day")} <span className="font-medium text-slate-300">{fmt(c.totalExtra)} €</span>
                        </div>
                        {e.ot && <div className="text-xs text-slate-400 mt-0.5">OT: {e.ot}</div>}
                        {e.notes && <div className="text-xs text-slate-500 italic mt-0.5">{e.notes}</div>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => startEdit(e)} className="p-1.5 text-slate-500"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteEntry(e.id)} className="p-1.5 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
                {entries.length === 0 && <div className="text-sm text-slate-500 text-center py-6">{tr("empty_entries")}</div>}
              </div>
            </section>
          </div>
        )}

        {tab === "calendari" && (
          <div className="space-y-4">
            <div className={`${cardCls} flex items-center justify-between`}>
              <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="p-1.5 text-slate-400"><ChevronLeft className="w-5 h-5" /></button>
              <div className="font-semibold text-slate-100">{monthLabel(month, lang)}</div>
              <button onClick={() => setMonth((m) => shiftMonth(m, 1))} className="p-1.5 text-slate-400"><ChevronRight className="w-5 h-5" /></button>
            </div>

            <div className={cardCls}>
              <div className="grid grid-cols-7 gap-1 text-center mb-1">
                {WEEKDAYS_BY_LANG[lang].map((w) => <div key={w} className="text-xs text-slate-500 font-medium">{w}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((dateStr, i) => {
                  if (!dateStr) return <div key={i} />;
                  const entry = entries.find((e) => e.date === dateStr);
                  const c = entry ? computeEntry(entry, settingsVersions, workplaces, festius, parades, reducedDays) : null;
                  const holiday = isHolidayDate(dateStr, festius);
                  const inParada = parades.some((p) => p.start <= dateStr && dateStr <= p.end);
                  const isReduced = reducedDays.some((r) => r.date === dateStr);
                  const day = Number(dateStr.slice(8, 10));
                  const isSelected = selectedDay === dateStr;
                  return (
                    <button
                      key={dateStr}
                      onClick={() => setSelectedDay(dateStr)}
                      className={`aspect-square rounded-lg text-xs flex flex-col items-center justify-center gap-0.5 border ${
                        isSelected ? "border-[#be0936] bg-[#3a0416]" : inParada ? (holiday ? "border-purple-800 bg-purple-950/50" : "border-emerald-900 bg-emerald-950/30") : holiday ? "border-orange-900 bg-orange-950/30" : isReduced ? "border-orange-500 bg-orange-600/25" : entry ? "border-slate-700 bg-slate-800" : "border-slate-800 bg-slate-900"
                      }`}
                    >
                      <span className={holiday ? "text-orange-300" : "text-slate-200"}>{day}</span>
                      {entry && entry.dayType && <span className="text-[10px] leading-none font-medium text-amber-300">{tr("ab_" + entry.dayType)}</span>}
                      {c && !entry.dayType && (
                        <span className="text-[10px] leading-none font-medium flex items-center gap-0.5">
                          <span className="text-blue-400">{fmtHoursCompact(c.normalHours)}</span>
                          {c.extraHours > 0 && <span className="text-green-400">+{fmtHoursCompact(c.extraHours)}</span>}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-xs text-slate-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-950/60 border border-orange-900 inline-block" /> {tr("legend_festiu")}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> {tr("legend_reduced")}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-950 border border-emerald-800 inline-block" /> {tr("legend_parada")}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-950 border border-purple-800 inline-block" /> {tr("legend_parada_festiu")}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> {tr("legend_base")}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> {tr("legend_extra")}</span>
              </div>
            </div>

            {selectedDay && (
              <div className={cardCls}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-100">{selectedDay}</h3>
                  <button onClick={() => setSelectedDay(null)} className="text-slate-500"><X className="w-4 h-4" /></button>
                </div>
                {selectedEntry ? (
                  <div className="text-sm text-slate-300 space-y-1">
                    <div>{tr("day_schedule")} <span className="text-slate-100">{selectedEntry.start}–{selectedEntry.end}</span> {selectedEntry.splitDay && <span className="text-slate-500">{tr("day_split_note")}</span>}</div>
                    <div>{tr("day_festiu")} <span className="text-slate-100">{selectedComputed.holiday ? tr("yes") : tr("no")}</span></div>
                    <div>{tr("day_workplace")} <span className="text-slate-100">{selectedComputed.workplaceName}</span></div>
                    <div>{tr("day_km")} <span className="text-slate-100">{fmt(selectedComputed.km)} km ({fmt(selectedComputed.kmAmount)} €)</span></div>
                    <div>{tr("day_diet")} <span className="text-slate-100">{selectedComputed.dietResolved === "none" ? tr("diet_none") : selectedComputed.dietResolved === "mitja" ? tr("diet_mitja") : tr("diet_completa")} ({fmt(selectedComputed.dietAmount)} €)</span></div>
                    <div>{tr("day_parada")} <span className="text-slate-100">{selectedComputed.paradaMode === "none" ? tr("parada_none") : selectedComputed.paradaMode === "normal" ? tr("parada_normal") : tr("parada_festiu")} ({fmt(selectedComputed.paradaAmount)} €)</span></div>
                    {selectedComputed.nightH > 0 && <div>{tr("nocturn_label")}: <span className="text-slate-100">{fmt(selectedComputed.nightH)} h ({fmt(selectedComputed.nocturnAmount)} €)</span></div>}
                    {selectedEntry.ot && <div>OT: <span className="text-slate-100">{selectedEntry.ot}</span></div>}
                    {(selectedEntry.tickets || []).map((tk, i) => <div key={i}>{tr("tickets_title")}: <span className="text-slate-100">{tk.concept} {fmt(Number(tk.amount) || 0)} € {tk.desc}</span></div>)}
                    {selectedEntry.dayType && <div>{tr("daytype_title")}: <span className="text-amber-300">{tr("daytype_" + selectedEntry.dayType)}</span></div>}
                    <div>{tr("day_hours")} <span className="text-slate-100">{fmt(selectedComputed.normalHours)}h / {fmt(selectedComputed.extraHours)}h</span></div>
                    <div className="pt-1 font-medium text-[#e21a4c]">{tr("day_total_extra")} {fmt(selectedComputed.totalExtra)} €</div>
                    {selectedEntry.notes && <div className="text-slate-400 italic pt-1">{selectedEntry.notes}</div>}
                    <div className="flex gap-2 pt-2">
                      <button onClick={() => startEdit(selectedEntry)} className="flex-1 bg-slate-800 text-slate-200 rounded-lg py-1.5 text-xs flex items-center justify-center gap-1"><Pencil className="w-3.5 h-3.5" /> {tr("btn_edit")}</button>
                      <button onClick={() => deleteEntry(selectedEntry.id)} className="flex-1 bg-slate-800 text-red-400 rounded-lg py-1.5 text-xs flex items-center justify-center gap-1"><Trash2 className="w-3.5 h-3.5" /> {tr("btn_delete")}</button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">
                    {tr("no_entry_day")}
                    <button
                      onClick={() => { setForm(emptyForm(selectedDay, festius, reducedDays)); setTab("fitxatge"); }}
                      className="mt-2 w-full bg-[#be0936] text-white rounded-lg py-1.5 text-xs flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> {tr("btn_add_for_day")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "resum" && (
          <div className="space-y-4">
            <div className={`${cardCls} flex items-center justify-between`}>
              <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="p-1.5 text-slate-400"><ChevronLeft className="w-5 h-5" /></button>
              <div className="font-semibold text-slate-100">{monthLabel(month, lang)}</div>
              <button onClick={() => setMonth((m) => shiftMonth(m, 1))} className="p-1.5 text-slate-400"><ChevronRight className="w-5 h-5" /></button>
            </div>

            <div className={cardCls}>
              <label className={labelCls}>{tr("month_base_label")}</label>
              <input
                type="number"
                step="0.01"
                value={monthlyBaseOverrides[month] !== undefined ? monthlyBaseOverrides[month] : getSettingsForDate(month + "-01", settingsVersions).souBase}
                onChange={(e) => setBaseOverride(month, e.target.value)}
                className={inputCls}
              />
              {monthlyBaseOverrides[month] !== undefined && (
                <button onClick={() => setBaseOverride(month, "")} className="text-xs text-[#e21a4c] mt-1">{tr("restore_default")}</button>
              )}
            </div>

            <div className="bg-slate-900 border border-[#5c0722] rounded-xl p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{tr("total_gross")}</div>
              <div className="text-3xl font-semibold text-slate-100">{fmt(monthSummary.totalBrut)} €</div>
              <div className="text-xs text-slate-500 mt-1">{tr("base_accum")} {fmt(monthSummary.base)} € + {tr("extra_accum")} {fmt(monthSummary.totalExtra)} €</div>
              <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Percent className="w-3.5 h-3.5" /> {tr("retention_label")}
                  <input
                    type="number"
                    step="0.1"
                    value={retencioPercent}
                    onChange={(e) => updateRetencio(Number(e.target.value))}
                    className="w-14 bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-slate-100"
                  />
                  %
                </div>
                <div className="text-lg font-semibold text-[#e21a4c]">{fmt(monthSummary.totalNet)} € {tr("net_suffix")}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-slate-500">{tr("normal_hours_card")}</div>
                <div className="text-lg font-semibold text-slate-100">{fmt(monthSummary.normalHours)} h</div>
              </div>
              <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-slate-500">{tr("extra_hours_card")}</div>
                <div className="text-lg font-semibold text-[#e21a4c]">{fmt(monthSummary.extraHours)} h</div>
                <div className="text-xs text-slate-500">{fmt(monthSummary.extraHoursAmount)} €</div>
              </div>
              <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-slate-500">{tr("km_card")} ({fmt(monthSummary.kmTotal)} km)</div>
                <div className="text-lg font-semibold text-slate-100">{fmt(monthSummary.kmAmount)} €</div>
              </div>
              <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-slate-500">{tr("diets_card")}</div>
                <div className="text-lg font-semibold text-slate-100">{fmt(monthSummary.dietAmount)} €</div>
              </div>
              <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-slate-500">{tr("parada_card")}</div>
                <div className="text-lg font-semibold text-slate-100">{fmt(monthSummary.paradaAmount)} €</div>
              </div>
              <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-slate-500">{tr("nocturn_label")} ({fmt(monthSummary.nocturnHours)} h)</div>
                <div className="text-lg font-semibold text-slate-100">{fmt(monthSummary.nocturnAmount)} €</div>
              </div>
                           </div>

            <div className={cardCls}>
              <h3 className="font-semibold text-slate-100 mb-2 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#e21a4c]" /> {tr("acum_title")} <span className="text-xs text-slate-500 font-normal">{annualSummary.year} · {tr("until_month", MONTH_NAMES_BY_LANG[lang][annualSummary.throughMonth - 1])}</span>
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-slate-500">{tr("base_accum")}</span><div className="text-slate-100 font-medium">{fmt(annualSummary.totalBase)} €</div></div>
                <div><span className="text-slate-500">{tr("extra_accum")}</span><div className="text-slate-100 font-medium">{fmt(annualSummary.totalExtra)} €</div></div>
                <div><span className="text-slate-500">{tr("total_gross2")}</span><div className="text-slate-100 font-medium">{fmt(annualSummary.totalBrut)} €</div></div>
                <div><span className="text-slate-500">{tr("total_net_est")}</span><div className="text-[#e21a4c] font-medium">{fmt(annualSummary.totalNet)} €</div></div>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800">
                <div className="text-xs text-slate-500">{tr("projection_label")}</div>
                <div className="flex items-center justify-between mt-1">
                  <div className="text-slate-100 font-medium">{fmt(annualSummary.projectedBrut)} € {tr("gross_suffix")}</div>
                  <div className="text-[#e21a4c] font-medium">{fmt(annualSummary.projectedNet)} € {tr("net_suffix")}</div>
                </div>
              </div>
            </div>

            <div className={cardCls}>
              <h3 className="font-semibold text-slate-100 mb-2 flex items-center gap-2">
                <CalendarRange className="w-4 h-4 text-[#e21a4c]" /> {tr("range_title")}
              </h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <label className={labelCls}>
                  {tr("from_label")}
                  <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className={inputCls} />
                </label>
                <label className={labelCls}>
                  {tr("to_label")}
                  <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className={inputCls} />
                </label>
              </div>

              {!rangeSummary ? (
                <p className="text-xs text-slate-500">{tr("invalid_range")}</p>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500">{tr("entries_in_range", rangeSummary.count)}</div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-slate-800 rounded-lg p-2.5">
                      <div className="text-xs text-slate-500">{tr("base_months")}</div>
                      <div className="text-slate-100 font-medium">{fmt(rangeSummary.baseTotal)} €</div>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-2.5">
                      <div className="text-xs text-slate-500">{tr("extra_hours_card")}</div>
                      <div className="text-slate-100 font-medium">{fmt(rangeSummary.extraHours)} h — {fmt(rangeSummary.extraHoursAmount)} €</div>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-2.5">
                      <div className="text-xs text-slate-500">{tr("km_total_range")}</div>
                      <div className="text-slate-100 font-medium">{fmt(rangeSummary.kmTotal)} km — {fmt(rangeSummary.kmAmount)} €</div>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-2.5">
                      <div className="text-xs text-slate-500">{tr("mitges_dietes")}</div>
                      <div className="text-slate-100 font-medium">{rangeSummary.mitjaCount} — {fmt(rangeSummary.mitjaAmount)} €</div>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-2.5">
                      <div className="text-xs text-slate-500">{tr("dietes_completes")}</div>
                      <div className="text-slate-100 font-medium">{rangeSummary.completaCount} — {fmt(rangeSummary.completaAmount)} €</div>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-2.5">
                      <div className="text-xs text-slate-500">{tr("parada_normal_range")}</div>
                      <div className="text-slate-100 font-medium">{rangeSummary.paradaNormalCount} — {fmt(rangeSummary.paradaNormalAmount)} €</div>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-2.5">
                      <div className="text-xs text-slate-500">{tr("parada_festiu_range")}</div>
                      <div className="text-slate-100 font-medium">{rangeSummary.paradaFestiuCount} — {fmt(rangeSummary.paradaFestiuAmount)} €</div>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-2.5">
                      <div className="text-xs text-slate-500">{tr("nocturn_label")} ({fmt(rangeSummary.nocturnHours)} h)</div>
                      <div className="text-slate-100 font-medium">{fmt(rangeSummary.nocturnAmount)} €</div>
                    </div>
                                       </div>

                  <div>
                    <div className="text-xs text-slate-500 mb-1">{tr("daytype_counts")}</div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {rangeDayTypes.map((x) => (
                        <div key={x.k} className="bg-slate-800 rounded-lg py-1.5 text-center">
                          <div className="text-[10px] text-amber-300">{tr("ab_" + x.k)}</div>
                          <div className="text-sm font-semibold text-slate-100">{x.n}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-500">{tr("total_gross_range")}</div>
                      <div className="text-xl font-semibold text-slate-100">{fmt(rangeSummary.totalBrut)} €</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">{tr("net_estimate", retencioPercent)}</div>
                      <div className="text-lg font-semibold text-[#e21a4c]">{fmt(rangeSummary.totalNet)} €</div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {tr("proportional_note", rangeSummary.months.join(", "))}
                  </p>
                </div>
              )}
            </div>

            <details className={cardCls}>
              <summary className="cursor-pointer text-sm font-semibold text-slate-100">{tr("tickets_title")} ({rangeTickets.length} · {fmt(rangeTickets.reduce((a, tk) => a + (Number(tk.amount) || 0), 0))} €)</summary>
              <div className="mt-2 space-y-1.5">
                {rangeTickets.length === 0 ? <p className="text-xs text-slate-500">{tr("no_tickets")}</p> : rangeTickets.map((tk, i) => (
                  <div key={i} className="bg-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 flex justify-between gap-2">
                    <span>{tk.date} · {tk.concept}{tk.desc ? ` — ${tk.desc}` : ""}</span>
                    <label className="flex items-center gap-1 shrink-0 text-slate-100">{fmt(Number(tk.amount) || 0)} €<input type="checkbox" checked={!!tk.paid} onChange={() => toggleTicketPaid(tk.entryId, tk.idx)} className="rounded ml-2" /><span className="text-[11px] text-slate-400">{tr("paid")}</span></label>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-2">{tr("tickets_note")}</p>
            </details>

            <button onClick={exportExcel} className="w-full bg-[#be0936] text-white rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2">
              <Download className="w-4 h-4" />
              {tr("export_button")}
            </button>
            <p className="text-xs text-slate-500 text-center px-4">{exportMsg || tr("export_note")}</p>

            <div>
              <h3 className="text-sm font-semibold text-slate-500 mb-2 px-1">{tr("month_entries_title", monthLabel(month, lang))}</h3>
              <div className="space-y-1.5">
                {monthEntries.map((e) => {
                  const c = computeEntry(e, settingsVersions, workplaces, festius, parades, reducedDays);
                  return (
                    <div key={e.id} className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs">
                      <span className="text-slate-300">{e.date} · {c.workplaceName} · {fmt(c.totalHours)}h</span>
                      <span className="text-slate-400">{fmt(c.totalExtra)} €</span>
                    </div>
                  );
                })}
                {monthEntries.length === 0 && <div className="text-xs text-slate-500 text-center py-3">{tr("no_entries_month")}</div>}
              </div>
            </div>
          </div>
        )}

        {tab === "config" && (
          <div className="space-y-4">
            <section className={cardCls}>
              <h2 className="font-semibold text-slate-100 mb-1 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-[#e21a4c]" /> {tr("ot_title")}
              </h2>
              <div className="flex gap-2 mb-2">
                <input value={otInput} onChange={(e) => setOtInput(e.target.value)} placeholder={tr("ot_placeholder")} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100" />
                <button onClick={addOT} className="bg-[#be0936] text-white rounded-lg px-3"><Plus className="w-4 h-4" /></button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ots.map((o) => (
                  <span key={o} className="flex items-center gap-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1 rounded-full">
                    {o}
                    <button onClick={() => deleteOT(o)}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            </section>

            <section className={cardCls}>
              <h2 className="font-semibold text-slate-100 mb-1 flex items-center gap-2">
                <History className="w-4 h-4 text-[#e21a4c]" /> {tr("price_history_title")}
              </h2>
              <p className="text-xs text-slate-500 mb-3">{tr("price_history_note")}</p>
              <div className="space-y-3">
                {[...settingsVersions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).map((v) => (
                  <div key={v.id} className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-slate-400 flex items-center gap-1.5">
                        {tr("effective_from")}
                        <input
                          type="date"
                          value={v.effectiveFrom}
                          onChange={(e) => {
                            const next = settingsVersions.map((x) => x.id === v.id ? { ...x, effectiveFrom: e.target.value } : x);
                            updateVersions(next);
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-100"
                        />
                      </label>
                      {settingsVersions.length > 1 && (
                        <button onClick={() => updateVersions(settingsVersions.filter((x) => x.id !== v.id))} className="text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ["souBase", tr("f_souBase")],
                        ["preuHoraExtra", tr("f_preuHoraExtra")],
                        ["preuKm", tr("f_preuKm")],
                        ["mitjaDieta", tr("f_mitjaDieta")],
                        ["dietaCompleta", tr("f_dietaCompleta")],
                        ["plusParadaNormal", tr("f_plusParadaNormal")],
                        ["plusParadaFestiu", tr("f_plusParadaFestiu")],
                        ["plusNocturnitat", tr("f_plusNocturnitat")],
                      ].map(([key, label]) => (
                        <label key={key} className="text-xs text-slate-400">
                          {label}
                          <input
                            type="number"
                            step="0.01"
                            value={v[key] ?? 0}
                            onChange={(e) => {
                              const next = settingsVersions.map((x) => x.id === v.id ? { ...x, [key]: Number(e.target.value) } : x);
                              updateVersions(next);
                            }}
                            className={inputCls}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const latest = [...settingsVersions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
                  const next = [...settingsVersions, { ...latest, id: Date.now().toString(), effectiveFrom: todayStr() }];
                  updateVersions(next);
                }}
                className="mt-3 w-full bg-slate-800 text-[#e21a4c] border border-[#5c0722] rounded-lg py-2 text-sm flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> {tr("add_version_btn")}
              </button>
            </section>

            <section className={cardCls}>
              <h2 className="font-semibold text-slate-100 mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#e21a4c]" /> {tr("workplaces_title")}
              </h2>
              <div className="flex flex-col gap-2 mb-3">
                <div className="flex gap-2">
                  <input placeholder={tr("name_placeholder")} value={wpForm.name} onChange={(e) => setWpForm((f) => ({ ...f, name: e.target.value }))} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100" />
                  <input placeholder={tr("km_placeholder")} type="number" step="0.1" value={wpForm.km} onChange={(e) => setWpForm((f) => ({ ...f, km: e.target.value }))} className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100" />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={wpForm.autoDieta} onChange={(e) => setWpForm((f) => ({ ...f, autoDieta: e.target.checked }))} className="rounded" />
                  {tr("auto_diet_checkbox")}
                </label>
                <button onClick={addWorkplace} className="bg-[#be0936] text-white rounded-lg py-1.5 text-sm flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> {tr("add_workplace_btn")}</button>
              </div>
              <div className="space-y-1.5">
                {workplaces.map((w) => (
                  <div key={w.id} className="flex flex-wrap gap-y-1 items-center justify-between bg-slate-800 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className="text-slate-200">{w.name}</span> <input type="number" step="0.1" value={w.km} onChange={(e) => updateWorkplaceKm(w.id, e.target.value)} className="w-16 mx-1 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-xs text-slate-100" /><span className="text-slate-500 text-xs">km</span>
                      {w.autoDieta && <span className="ml-2 text-xs bg-[#3a0416] text-[#e21a4c] px-1.5 py-0.5 rounded">{tr("auto_diet_badge")}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleWorkplacePartit(w.id)} className="text-xs text-slate-400">{isPartit(w) ? tr("partit_on") : tr("partit_off")}</button>
                      <button onClick={() => toggleWorkplaceAutoDieta(w.id)} className="text-xs text-slate-400">{w.autoDieta ? tr("deactivate") : tr("activate_diet")}</button>
                      <button onClick={() => deleteWorkplace(w.id)} className="text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
                {workplaces.length === 0 && <div className="text-xs text-slate-500 text-center py-3">{tr("no_workplaces")}</div>}
              </div>
            </section>

            <section className={cardCls}>
              <h2 className="font-semibold text-slate-100 mb-1 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" /> {tr("parades_title")}
              </h2>
              <p className="text-xs text-slate-500 mb-3">{tr("parades_note")}</p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <select value={paradaForm.workplaceId} onChange={(e) => setParadaForm((f) => ({ ...f, workplaceId: e.target.value }))} className={`${inputCls} col-span-2 !mt-0`}>
                  <option value="">{tr("parada_central")}</option>
                  {workplaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <input type="date" value={paradaForm.start} onChange={(e) => setParadaForm((f) => ({ ...f, start: e.target.value }))} className={`${inputCls} !mt-0`} />
                <input type="date" value={paradaForm.end} onChange={(e) => setParadaForm((f) => ({ ...f, end: e.target.value }))} className={`${inputCls} !mt-0`} />
              </div>
              <button onClick={addParada} className="w-full bg-[#be0936] text-white rounded-lg py-1.5 text-sm flex items-center justify-center gap-1 mb-3"><Plus className="w-4 h-4" /> {tr("add_parada")}</button>
              <div className="space-y-1.5">
                {parades.map((p) => (
                  <div key={p.id} className="bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2 text-sm">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-slate-200">{workplaces.find((w) => w.id === p.workplaceId)?.name || "—"}</span>
                      <button onClick={() => deleteParada(p.id)} className="text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="date" value={p.start} onChange={(e) => updateParada(p.id, "start", e.target.value)} className={`${inputCls} !mt-0`} />
                      <input type="date" value={p.end} onChange={(e) => updateParada(p.id, "end", e.target.value)} className={`${inputCls} !mt-0`} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={cardCls}>
              <h2 className="font-semibold text-slate-100 mb-3 flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[#e21a4c]" /> {tr("festius_title")}
              </h2>
              <p className="text-xs text-slate-500 mb-3">{tr("festius_note")}</p>
              <div className="flex gap-2 mb-3">
                <input type="date" value={festiuInput} onChange={(e) => setFestiuInput(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100" />
                <button onClick={addFestiu} className="bg-[#be0936] text-white rounded-lg px-3"><Plus className="w-4 h-4" /></button>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                {festius.map((f) => (
                  <span key={f} className="flex items-center gap-1 bg-orange-950/50 border border-orange-900 text-orange-300 text-xs px-2 py-1 rounded-full">
                    {f}
                    <button onClick={() => removeFestiu(f)}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            </section>
            <section className={cardCls}>
              <h2 className="font-semibold text-slate-100 mb-1 flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-orange-400" /> {tr("reduced_title")}
              </h2>
              <p className="text-xs text-slate-500 mb-3">{tr("reduced_note")}</p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <input type="date" value={reducedForm.date} onChange={(e) => setReducedForm((f) => ({ ...f, date: e.target.value }))} className={`${inputCls} col-span-3 !mt-0`} />
                <select value={reducedForm.start} onChange={(e) => setReducedForm((f) => ({ ...f, start: e.target.value }))} className={`${inputCls} !mt-0`}>
                  {TIME_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                <select value={reducedForm.end} onChange={(e) => setReducedForm((f) => ({ ...f, end: e.target.value }))} className={`${inputCls} !mt-0`}>
                  {TIME_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                <button onClick={addReduced} className="bg-[#be0936] text-white rounded-lg flex items-center justify-center"><Plus className="w-4 h-4" /></button>
              </div>
              <div className="space-y-1.5">
                {reducedDays.map((r) => (
                  <div key={r.id} className="flex items-center justify-between bg-orange-600/15 border border-orange-500/60 rounded-lg px-3 py-2 text-sm">
                    <span className="text-slate-200">{r.date} · {r.start}–{r.end}</span>
                    <button onClick={() => deleteReduced(r.id)} className="text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={undoConfig} disabled={!undoStack.length} className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-40">
                <RotateCcw className="w-4 h-4" /> {tr("undo_btn")} ({undoStack.length})
              </button>
              <button onClick={redoConfig} disabled={!redoStack.length} className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-40">
                {tr("redo_btn")} ({redoStack.length}) <RotateCcw className="w-4 h-4 -scale-x-100" />
              </button>
            </div>

            <section className={cardCls}>
              <h2 className="font-semibold text-slate-100 mb-3 flex items-center gap-2">
                <SettingsIcon className="w-4 h-4 text-[#e21a4c]" /> {tr("language_title")}
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => updateLang(l.code)}
                    className={`rounded-lg py-2 text-sm font-medium border ${
                      lang === l.code ? "bg-[#be0936] border-[#be0936] text-white" : "bg-slate-800 border-slate-700 text-slate-300"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </section>

            <div className="space-y-2">
              <button onClick={exportBackup} className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2">
                <Download className="w-4 h-4" />
                {tr("backup_button")}
              </button>
              <label className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4" />
                {tr("import_button")}
                <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { importBackup(e.target.files[0]); e.target.value = ""; }} />
              </label>
              <p className="text-xs text-slate-500 text-center px-4">{importMsg || exportMsg || tr("backup_note")}</p>
            </div>

            <p className="text-center text-[11px] text-slate-600 pt-2">V. Moya, Versió 1.3.</p>
          </div>
        )}
      </main>
    </div>
  );
}
