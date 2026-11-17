import { db } from "../db/index.js";
import { briefings, campaigns, results, type Campaign } from "./repo.js";

export interface Funnel {
  investimento: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  conversas_plataforma: number;
  leads: number;
  qualificados: number;
  simulacoes: number;
  visitas: number;
  vendas: number;
  receita: number;
}

export interface Kpis extends Funnel {
  ctr_pct: number | null;
  cpc: number | null;
  cpm: number | null;
  cpl: number | null;
  custo_qualificado: number | null;
  custo_por_venda: number | null;
  taxa_qualificacao_pct: number | null;
  taxa_conversao_pct: number | null;
  ticket_medio: number | null;
  roas: number | null;
  lucro_bruto: number | null;
  roi_pct: number | null;
  margem_pct: number | null;
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function kpis(f: Funnel, margemPct: number | null): Kpis {
  const lucro = margemPct != null ? f.receita * (margemPct / 100) : null;
  return {
    ...f,
    ctr_pct: pct(f.cliques, f.impressoes),
    cpc: div(f.investimento, f.cliques),
    cpm: f.impressoes ? (f.investimento / f.impressoes) * 1000 : null,
    cpl: div(f.investimento, f.leads),
    custo_qualificado: div(f.investimento, f.qualificados),
    custo_por_venda: div(f.investimento, f.vendas),
    taxa_qualificacao_pct: pct(f.qualificados, f.leads),
    taxa_conversao_pct: pct(f.vendas, f.leads),
    ticket_medio: div(f.receita, f.vendas),
    roas: div(f.receita, f.investimento),
    lucro_bruto: lucro,
    roi_pct: lucro != null && f.investimento > 0 ? Math.round(((lucro - f.investimento) / f.investimento) * 1000) / 10 : null,
    margem_pct: margemPct,
  };
}

const QUALIFIED = `(l.temperatura IN ('quente','pronto') OR l.stage IN ('simulacao','visita_agendada','negociacao','vendido'))`;

/** Números do funil dos leads (do WhatsApp) que satisfazem o filtro. */
function leadFunnel(where: string, vals: unknown[]) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS leads,
        SUM(CASE WHEN ${QUALIFIED} THEN 1 ELSE 0 END) AS qualificados,
        SUM(CASE WHEN l.stage IN ('simulacao','visita_agendada','negociacao','vendido') OR EXISTS (SELECT 1 FROM simulations s WHERE s.contact_id = c.id AND s.status != 'coletando') THEN 1 ELSE 0 END) AS simulacoes,
        SUM(CASE WHEN l.stage = 'visita_agendada' OR EXISTS (SELECT 1 FROM appointments a WHERE a.contact_id = c.id AND a.status != 'cancelada') THEN 1 ELSE 0 END) AS visitas,
        SUM(CASE WHEN l.stage = 'vendido' THEN 1 ELSE 0 END) AS vendas,
        COALESCE(SUM(CASE WHEN l.stage = 'vendido' THEN l.valor_venda ELSE 0 END), 0) AS receita
       FROM contacts c JOIN leads l ON l.contact_id = c.id
       WHERE ${where}`,
    )
    .get(...(vals as any[])) as Record<string, number | null>;
  return {
    leads: Number(r.leads ?? 0),
    qualificados: Number(r.qualificados ?? 0),
    simulacoes: Number(r.simulacoes ?? 0),
    visitas: Number(r.visitas ?? 0),
    vendas: Number(r.vendas ?? 0),
    receita: Number(r.receita ?? 0),
  };
}

function sumResults(rows: { investimento: number; impressoes: number; alcance: number; cliques: number; conversas: number }[]) {
  return rows.reduce(
    (a, r) => ({
      investimento: a.investimento + r.investimento,
      impressoes: a.impressoes + r.impressoes,
      alcance: a.alcance + r.alcance,
      cliques: a.cliques + r.cliques,
      conversas_plataforma: a.conversas_plataforma + r.conversas,
    }),
    { investimento: 0, impressoes: 0, alcance: 0, cliques: 0, conversas_plataforma: 0 },
  );
}

export const margemOf = (storeId: number): number | null => {
  const v = Number(briefings.get(storeId).respostas.margem_pct);
  return Number.isFinite(v) && v > 0 ? v : null;
};

const day = (iso: string) => iso.slice(0, 10);

export function campaignMetrics(c: Campaign) {
  const rows = results.forCampaign(c.id);
  const f: Funnel = { ...sumResults(rows), ...leadFunnel("c.campaign_id = ?", [c.id]) };
  const leadsByDay = db
    .prepare("SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n FROM contacts WHERE campaign_id = ? GROUP BY d")
    .all(c.id) as { d: string; n: number }[];
  const days = new Set([...rows.map((r) => r.data), ...leadsByDay.map((x) => x.d)]);
  const serie = [...days].sort().map((d) => {
    const r = rows.find((x) => x.data === d);
    const leads = leadsByDay.find((x) => x.d === d)?.n ?? 0;
    return { data: d, investimento: r?.investimento ?? 0, leads, cpl: r && leads ? r.investimento / leads : null };
  });
  const metas = c.plano?.metas ?? null;
  return { kpis: kpis(f, margemOf(c.store_id)), serie, resultados: rows, metas };
}

/** Painel de resultados da loja: todas as campanhas no período, mais os leads orgânicos e de anúncio sem campanha. */
export function storeMarketing(storeId: number, dias: number) {
  const ate = new Date();
  const de = new Date(ate.getTime() - (dias - 1) * 86400_000);
  const deD = day(de.toISOString());
  const ateD = day(ate.toISOString());
  const rows = results.forStore(storeId, deD, ateD);
  const margem = margemOf(storeId);
  const periodo = "c.store_id = ? AND substr(c.created_at, 1, 10) BETWEEN ? AND ?";

  const total = kpis({ ...sumResults(rows), ...leadFunnel(`${periodo} AND c.campaign_id IS NOT NULL`, [storeId, deD, ateD]) }, margem);
  const lista = campaigns.list(storeId).filter((c) => c.status !== "gerando" && c.status !== "erro");
  const porCampanha = lista.map((c) => {
    const r = rows.filter((x) => x.campaign_id === c.id);
    const k = kpis({ ...sumResults(r), ...leadFunnel(`${periodo} AND c.campaign_id = ?`, [storeId, deD, ateD, c.id]) }, margem);
    return { id: c.id, nome: c.nome, status: c.status, metas: c.plano?.metas ?? null, kpis: k };
  });
  const semCampanha = leadFunnel(`${periodo} AND c.campaign_id IS NULL AND c.origem = 'anuncio'`, [storeId, deD, ateD]);
  const organico = leadFunnel(`${periodo} AND c.campaign_id IS NULL AND (c.origem IS NULL OR c.origem != 'anuncio') AND c.channel = 'whatsapp'`, [storeId, deD, ateD]);

  const leadsByDay = db
    .prepare(`SELECT substr(c.created_at, 1, 10) AS d, COUNT(*) AS n FROM contacts c WHERE ${periodo} AND c.campaign_id IS NOT NULL GROUP BY d`)
    .all(storeId, deD, ateD) as { d: string; n: number }[];
  const serie: { data: string; investimento: number; leads: number; cpl: number | null }[] = [];
  for (let t = de.getTime(); t <= ate.getTime() + 1; t += 86400_000) {
    const d = day(new Date(t).toISOString());
    const inv = rows.filter((x) => x.data === d).reduce((a, x) => a + x.investimento, 0);
    const leads = leadsByDay.find((x) => x.d === d)?.n ?? 0;
    serie.push({ data: d, investimento: inv, leads, cpl: inv && leads ? inv / leads : null });
  }
  return { periodo: { de: deD, ate: ateD, dias }, total, campanhas: porCampanha, sem_campanha: semCampanha, organico, serie, margem_pct: margem };
}
