import type { StoreSettings } from "../types.js";
import { appointments } from "../db/repos.js";
import { addDays, fromZoned, weekdayName, weekdayOf, zonedParts } from "../util/time.js";

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function isOpenNow(s: StoreSettings, at: Date = new Date()): boolean {
  const p = zonedParts(at);
  const h = s.horarios[p.weekday];
  if (!h) return false;
  const now = p.hour * 60 + p.minute;
  return now >= toMin(h.abre) && now < toMin(h.fecha);
}

export function hoursText(s: StoreSettings): string {
  const groups: string[] = [];
  s.horarios.forEach((h, i) => groups.push(`${weekdayName(i)}: ${h ? `${h.abre} às ${h.fecha}` : "fechado"}`));
  return groups.join("; ");
}

export interface Slot {
  data: string; // YYYY-MM-DD
  hora: string; // HH:MM
  iso: string;
  label: string;
  /** rótulo curto para botão do WhatsApp (até 20 caracteres), ex.: "Qua 18/11 · 10h" */
  curto: string;
}

/** Horários livres a partir de agora, respeitando expediente, antecedência mínima e lotação. */
export function availableSlots(storeId: number, s: StoreSettings, opts: { data?: string | null; periodo?: "manha" | "tarde" | null; limite?: number } = {}): Slot[] {
  const out: Slot[] = [];
  const now = new Date();
  const earliest = now.getTime() + s.agenda.antecedencia_min_horas * 3600_000;
  const today = zonedParts(now).date;
  const days = opts.data ? [opts.data] : Array.from({ length: s.agenda.dias_a_frente }, (_, i) => addDays(today, i));
  const step = Math.max(30, s.agenda.duracao_min);
  for (const d of days) {
    const wd = weekdayOf(d);
    const h = s.horarios[wd];
    if (!h) continue;
    for (let m = toMin(h.abre); m + Math.min(step, 60) <= toMin(h.fecha); m += step) {
      if (opts.periodo === "manha" && m >= 12 * 60) continue;
      if (opts.periodo === "tarde" && m < 12 * 60) continue;
      const hora = toHHMM(m);
      const dt = fromZoned(d, hora);
      if (dt.getTime() < earliest) continue;
      if (appointments.countAt(storeId, dt.toISOString()) >= s.agenda.max_por_horario) continue;
      const [, mm, dd] = d.split("-");
      const short = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][wd];
      const hShort = hora.endsWith(":00") ? `${Number(hora.slice(0, 2))}h` : hora.replace(":", "h");
      out.push({ data: d, hora, iso: dt.toISOString(), label: `${weekdayName(wd)} ${dd}/${mm} às ${hora}`, curto: `${short} ${dd}/${mm} · ${hShort}` });
      if (out.length >= (opts.limite ?? 12)) return out;
    }
  }
  return out;
}

export type SlotCheck = { ok: true; iso: string; label: string } | { ok: false; motivo: string; sugestoes: Slot[] };

export function checkSlot(storeId: number, s: StoreSettings, data: string, hora: string): SlotCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) {
    return { ok: false, motivo: "Data ou hora em formato inválido (use AAAA-MM-DD e HH:MM).", sugestoes: availableSlots(storeId, s, { limite: 6 }) };
  }
  const wd = weekdayOf(data);
  const h = s.horarios[wd];
  const sugestoesDia = () => {
    const doDia = availableSlots(storeId, s, { data, limite: 6 });
    return doDia.length ? doDia : availableSlots(storeId, s, { limite: 6 });
  };
  if (!h) return { ok: false, motivo: `A loja não abre ${weekdayName(wd)}.`, sugestoes: availableSlots(storeId, s, { limite: 6 }) };
  const m = toMin(hora);
  if (m < toMin(h.abre) || m >= toMin(h.fecha)) {
    return { ok: false, motivo: `Fora do horário (${weekdayName(wd)} a loja funciona das ${h.abre} às ${h.fecha}).`, sugestoes: sugestoesDia() };
  }
  const dt = fromZoned(data, hora);
  if (dt.getTime() < Date.now() + s.agenda.antecedencia_min_horas * 3600_000) {
    return { ok: false, motivo: "Esse horário já passou ou está em cima da hora.", sugestoes: sugestoesDia() };
  }
  const maxDate = Date.now() + (s.agenda.dias_a_frente + 1) * 86400_000;
  if (dt.getTime() > maxDate) return { ok: false, motivo: `A agenda abre só ${s.agenda.dias_a_frente} dias à frente.`, sugestoes: availableSlots(storeId, s, { limite: 6 }) };
  if (appointments.countAt(storeId, dt.toISOString()) >= s.agenda.max_por_horario) {
    return { ok: false, motivo: "Esse horário já está lotado.", sugestoes: sugestoesDia() };
  }
  const [, mm, dd] = data.split("-");
  return { ok: true, iso: dt.toISOString(), label: `${weekdayName(wd)} ${dd}/${mm} às ${hora}` };
}
