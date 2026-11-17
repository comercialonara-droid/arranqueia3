import { db } from "../db/index.js";
import { aiTurns, leads, vehicles, vehicleTitle } from "../db/repos.js";
import { config } from "../config.js";
import { zonedParts, addDays, fromZoned } from "../util/time.js";

type Row = Record<string, any>;
const count = (sql: string, ...p: any[]) => Number((db.prepare(sql).get(...p) as Row)?.n ?? 0);

/** Preço de referência do Claude Opus 5.5 (US$ por milhão de tokens). Ajuste se usar outro modelo. */
const PRICE = { input: 4, output: 20, cacheRead: 0.2 };

export function dashboardStats(dias = 7) {
  const today = zonedParts().date;
  const startDate = addDays(today, -(dias - 1));
  const since = fromZoned(startDate, "00:00").toISOString();
  const prevSince = fromZoned(addDays(startDate, -dias), "00:00").toISOString();

  const kpi = (from: string, to: string) => ({
    conversas: count("SELECT COUNT(*) n FROM events WHERE name='nova_conversa' AND created_at >= ? AND created_at < ?", from, to),
    de_anuncio: count("SELECT COUNT(DISTINCT contact_id) n FROM events WHERE name='entrada_anuncio' AND created_at >= ? AND created_at < ?", from, to),
    leads_qualificados: count("SELECT COUNT(*) n FROM events WHERE name='capi:lead' AND created_at >= ? AND created_at < ?", from, to),
    visitas_agendadas: count("SELECT COUNT(*) n FROM events WHERE name='visita_agendada' AND created_at >= ? AND created_at < ?", from, to),
    transferencias: count("SELECT COUNT(*) n FROM events WHERE name='handoff' AND created_at >= ? AND created_at < ?", from, to),
    vendas: count("SELECT COUNT(*) n FROM events WHERE name='venda' AND created_at >= ? AND created_at < ?", from, to),
    faturamento: Number(
      (db.prepare("SELECT COALESCE(SUM(json_extract(payload,'$.valor')),0) v FROM events WHERE name='venda' AND created_at >= ? AND created_at < ?").get(from, to) as Row)
        .v,
    ),
  });
  const nowIso = new Date(Date.now() + 1000).toISOString();
  const atual = kpi(since, nowIso);
  const anterior = kpi(prevSince, since);

  // tempo da primeira resposta (segundos), contatos que começaram no período
  const firsts = db
    .prepare(
      `SELECT c.id,
        (SELECT MIN(created_at) FROM messages WHERE contact_id=c.id AND direction='in') AS fin,
        (SELECT MIN(created_at) FROM messages WHERE contact_id=c.id AND direction='out' AND created_at >= (SELECT MIN(created_at) FROM messages WHERE contact_id=c.id AND direction='in')) AS fout
       FROM contacts c WHERE c.created_at >= ?`,
    )
    .all(since) as Row[];
  const diffs = firsts.filter((r) => r.fin && r.fout).map((r) => (new Date(r.fout).getTime() - new Date(r.fin).getTime()) / 1000);
  diffs.sort((a, b) => a - b);
  const mediana = diffs.length ? diffs[Math.floor(diffs.length / 2)] : null;

  // série diária
  const serie: { dia: string; conversas: number; visitas: number; leads: number }[] = [];
  for (let i = 0; i < dias; i++) {
    const d = addDays(startDate, i);
    const from = fromZoned(d, "00:00").toISOString();
    const to = fromZoned(addDays(d, 1), "00:00").toISOString();
    serie.push({
      dia: d,
      conversas: count("SELECT COUNT(*) n FROM events WHERE name='nova_conversa' AND created_at >= ? AND created_at < ?", from, to),
      leads: count("SELECT COUNT(*) n FROM events WHERE name='capi:lead' AND created_at >= ? AND created_at < ?", from, to),
      visitas: count("SELECT COUNT(*) n FROM events WHERE name='visita_agendada' AND created_at >= ? AND created_at < ?", from, to),
    });
  }

  // anúncios que mais trazem conversa e visita
  const anuncios = db
    .prepare(
      `SELECT COALESCE(c.ad_headline, c.ad_id, 'Anúncio sem título') AS anuncio, COUNT(*) AS conversas,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM events e WHERE e.contact_id=c.id AND e.name='visita_agendada') THEN 1 ELSE 0 END) AS visitas,
        SUM(CASE WHEN l.stage='vendido' THEN 1 ELSE 0 END) AS vendas
       FROM contacts c JOIN leads l ON l.contact_id=c.id
       WHERE c.ctwa_clid IS NOT NULL AND c.created_at >= ?
       GROUP BY anuncio ORDER BY conversas DESC LIMIT 8`,
    )
    .all(since);

  // carros mais procurados
  const interesse = new Map<string, number>();
  for (const l of leads.board()) for (const id of l.interesse) interesse.set(id, (interesse.get(id) ?? 0) + 1);
  const fotos = db
    .prepare("SELECT json_extract(payload,'$.veiculo_id') AS id, COUNT(*) n FROM events WHERE name='fotos_enviadas' AND created_at >= ? GROUP BY id")
    .all(since) as Row[];
  for (const f of fotos) interesse.set(f.id, (interesse.get(f.id) ?? 0) + Number(f.n));
  const carros = [...interesse.entries()]
    .map(([id, n]) => ({ id, n, v: vehicles.get(id) }))
    .filter((x) => x.v)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
    .map((x) => ({ id: x.id, titulo: vehicleTitle(x.v!), procura: x.n, status: x.v!.status }));

  const usage = aiTurns.usageTotals(since);
  const custo_usd = (usage.input * PRICE.input + usage.output * PRICE.output + usage.cache_read * PRICE.cacheRead) / 1_000_000;

  return {
    periodo: { dias, inicio: startDate, fim: today },
    atual,
    anterior,
    primeira_resposta_mediana_s: mediana,
    funil: leads.countByStage(),
    serie,
    anuncios,
    carros,
    ia: { modelo: config.ai.model, provedor: config.ai.provider, tokens: usage, custo_estimado_usd: Math.round(custo_usd * 100) / 100 },
  };
}
