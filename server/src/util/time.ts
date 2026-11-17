import { config } from "../config.js";

const tz = () => config.timezone;

/** Partes de data/hora no fuso da loja. */
export function zonedParts(d: Date = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: weekdayMap[p.weekday as string] ?? 0,
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`,
  };
}

/** Diferença em minutos entre o fuso da loja e UTC num instante. */
function offsetMinutes(at: Date): number {
  const p = zonedParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** Converte "2026-11-18" + "14:30" no fuso da loja para um Date (UTC). */
export function fromZoned(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off = offsetMinutes(guess);
  const result = new Date(guess.getTime() - off * 60000);
  // corrige transições de horário (não há horário de verão no Brasil hoje, mas fica robusto)
  const off2 = offsetMinutes(result);
  return off2 === off ? result : new Date(guess.getTime() - off2 * 60000);
}

const weekdayNames = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export const weekdayName = (n: number) => weekdayNames[n] ?? "";

/** Ex.: "terça-feira, 17/11/2026 13:07" */
export function humanNow(d: Date = new Date()) {
  const p = zonedParts(d);
  return `${weekdayName(p.weekday)}, ${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year} ${p.time}`;
}

export function formatDateTimeBR(d: Date) {
  const p = zonedParts(d);
  return `${weekdayName(p.weekday)}, ${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")} às ${p.time}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: v % 1 === 0 ? 0 : 2 });

export const kmFmt = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR")} km`);
