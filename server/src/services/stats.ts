import { db } from "../db/index.js";
import { aiTurns, leads, users, vehicles, vehicleTitle } from "../db/repos.js";
import { config } from "../config.js";
import { zonedParts, addDays, fromZoned } from "../util/time.js";

type Row = Record<string, any>;

/** Preço de referência do Claude Opus 5.5 (US$ por milhão de tokens). */
const PRICE = { input: 4, output: 20, cacheRead: 0.2 };

export function dashboardStats(storeId: number, dias = 7, sellerId: number | null = null) {
  const today = zonedParts().date;
  const startDate = addDays(today, -(dias - 1));
  const since = fromZoned(startDate, "00:00").toISOString();
  const prevSince = fromZoned(addDays(startDate, -dias), "00:00").toISOString();
  const sellerJoin = sellerId != null ? "JOIN contacts sc ON sc.id = e.contact_id AND sc.seller_id = ?" : "";
  const sp = sellerId != null ? [sellerId] : [];

  const count = (name: string, from: string, to: string, distinct = false) =>
    Number(
      (
        db
          .prepare(`SELECT COUNT(${distinct ? "DISTINCT e.contact_id" : "*"}) n FROM events e ${sellerJoin} WHERE e.store_id = ? AND e.name = ? AND e.created_at >= ? AND e.created_at < ?`)
          .get(...sp, storeId, name, from, to) as Row
      ).n,
    );

  const kpi = (from: string, to: string) => ({
    conversas: count("nova_conversa", from, to),
    de_anuncio: count("entrada_anuncio", from, to, true),
    leads_qualificados: count("capi:lead", from, to),
    simulacoes: count("simulacao_enviada", from, to),
    visitas_agendadas: count("visita_agendada", from, to),
    transferencias: count("handoff", from, to),
    vendas: count("venda", from, to),
    faturamento: Number(
      (
        db
          .prepare(`SELECT COALESCE(SUM(json_extract(e.payload,'$.valor')),0) v FROM events e ${sellerJoin} WHERE e.store_id = ? AND e.name='venda' AND e.created_at >= ? AND e.created_at < ?`)
          .get(...sp, storeId, from, to) as Row
      ).v,
    ),
  });
  const now = new Date(Date.now() + 1000).toISOString();
  const atual = kpi(since, now);
  const anterior = kpi(prevSince, since);

  const firsts = db
    .prepare(
      `SELECT (SELECT MIN(created_at) FROM messages WHERE contact_id=c.id AND direction='in') AS fin,
        (SELECT MIN(created_at) FROM messages WHERE contact_id=c.id AND direction='out' AND created_at >= (SELECT MIN(created_at) FROM messages WHERE contact_id=c.id AND direction='in')) AS fout
       FROM contacts c WHERE c.store_id = ? AND c.created_at >= ? ${sellerId != null ? "AND c.seller_id = ?" : ""}`,
    )
    .all(storeId, since, ...sp) as Row[];
  const diffs = firsts.filter((r) => r.fin && r.fout).map((r) => (new Date(r.fout).getTime() - new Date(r.fin).getTime()) / 1000).sort((a, b) => a - b);

  const serie: { dia: string; conversas: number; simulacoes: number; visitas: number }[] = [];
  for (let i = 0; i < dias; i++) {
    const d = addDays(startDate, i);
    const from = fromZoned(d, "00:00").toISOString();
    const to = fromZoned(addDays(d, 1), "00:00").toISOString();
    serie.push({ dia: d, conversas: count("nova_conversa", from, to), simulacoes: count("simulacao_enviada", from, to), visitas: count("visita_agendada", from, to) });
  }

  const anuncios = db
    .prepare(
      `SELECT COALESCE(c.ad_headline, c.ad_id, 'Anúncio sem título') AS anuncio, COUNT(*) AS conversas,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM simulations s WHERE s.contact_id=c.id AND s.status != 'coletando') THEN 1 ELSE 0 END) AS simulacoes,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM events e WHERE e.contact_id=c.id AND e.name='visita_agendada') THEN 1 ELSE 0 END) AS visitas,
        SUM(CASE WHEN l.stage='vendido' THEN 1 ELSE 0 END) AS vendas
       FROM contacts c JOIN leads l ON l.contact_id=c.id
       WHERE c.store_id = ? AND c.ctwa_clid IS NOT NULL AND c.created_at >= ?
       GROUP BY anuncio ORDER BY conversas DESC LIMIT 8`,
    )
    .all(storeId, since);

  const interesse = new Map<string, number>();
  for (const l of leads.board(storeId, sellerId)) for (const id of l.interesse) interesse.set(id, (interesse.get(id) ?? 0) + 1);
  const carros = [...interesse.entries()]
    .map(([id, n]) => ({ id, n, v: vehicles.get(id, storeId) }))
    .filter((x) => x.v)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
    .map((x) => ({ id: x.id, titulo: vehicleTitle(x.v!), procura: x.n, status: x.v!.status }));

  // desempenho por vendedor (só para dono/admin)
  const vendedores =
    sellerId != null
      ? []
      : users.sellers(storeId).map((u) => {
          const q = (sql: string) => Number((db.prepare(sql).get(storeId, u.id, since) as Row).n);
          return {
            id: u.id,
            nome: u.nome,
            leads: q("SELECT COUNT(*) n FROM contacts WHERE store_id = ? AND seller_id = ? AND created_at >= ?"),
            simulacoes: q("SELECT COUNT(*) n FROM simulations WHERE store_id = ? AND seller_id = ? AND enviada_em >= ?"),
            aprovadas: q("SELECT COUNT(*) n FROM simulations WHERE store_id = ? AND seller_id = ? AND status = 'aprovada' AND updated_at >= ?"),
            vendas: q("SELECT COUNT(*) n FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE l.store_id = ? AND c.seller_id = ? AND l.stage = 'vendido' AND l.stage_changed_at >= ?"),
          };
        });

  const usage = aiTurns.usageTotals(storeId, since);
  const custo = (usage.input * PRICE.input + usage.output * PRICE.output + usage.cache_read * PRICE.cacheRead) / 1_000_000;

  return {
    periodo: { dias, inicio: startDate, fim: today },
    atual,
    anterior,
    primeira_resposta_mediana_s: diffs.length ? diffs[Math.floor(diffs.length / 2)] : null,
    funil: leads.countByStage(storeId, sellerId),
    serie,
    anuncios,
    carros,
    vendedores,
    ia: { modelo: config.ai.model, provedor: config.ai.provider, tokens: usage, custo_estimado_usd: Math.round(custo * 100) / 100 },
  };
}
