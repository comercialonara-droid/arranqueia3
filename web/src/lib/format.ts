import type { Vehicle } from "./api";

export const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: v % 1 === 0 ? 0 : 2 });

export const km = (v: number | null | undefined) => (v == null ? "km não informado" : `${v.toLocaleString("pt-BR")} km`);

export const num = (v: number) => v.toLocaleString("pt-BR");

export const vehicleTitle = (v: Pick<Vehicle, "marca" | "modelo" | "versao">) => [v.marca, v.modelo, v.versao].filter(Boolean).join(" ");

export const vehicleYear = (v: Pick<Vehicle, "ano_fab" | "ano_modelo">) =>
  v.ano_fab && v.ano_modelo && v.ano_fab !== v.ano_modelo ? `${v.ano_fab}/${v.ano_modelo}` : String(v.ano_modelo ?? v.ano_fab ?? "");

export const contactName = (c: { nome: string | null; nome_perfil: string | null; wa_id: string }) =>
  c.nome || c.nome_perfil || (c.wa_id.startsWith("sim") ? "Cliente do simulador" : `+${c.wa_id}`);

export const phone = (waId: string) => {
  if (waId.startsWith("sim")) return "Simulador";
  const d = waId.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  return `+${d}`;
};

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
export function ago(iso: string | null | undefined) {
  if (!iso) return "";
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return "agora";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

export const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
export const dateShort = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
export const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400_000);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === tomorrow.toDateString()) return "Amanhã";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
};

export const pagamentoLabel: Record<string, string> = {
  a_vista: "À vista",
  financiamento: "Financiamento",
  consorcio: "Consórcio",
  troca_mais_diferenca: "Troca + diferença",
  indefinido: "A definir",
};
export const urgenciaLabel: Record<string, string> = { imediata: "Quer comprar já", "30_dias": "Em até 30 dias", pesquisando: "Pesquisando" };
export const tipoVisitaLabel: Record<string, string> = { visita: "Visita", test_drive: "Test-drive", avaliacao_troca: "Avaliação da troca" };
