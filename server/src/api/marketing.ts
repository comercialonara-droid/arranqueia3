import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { getSettings } from "../db/settings.js";
import { vehicles, vehicleTitle } from "../db/repos.js";
import { profileOf } from "../segments.js";
import { requireAuth, requireRole, storeOf, userOf } from "./auth.js";
import { completeness, questionsFor } from "../marketing/questionnaire.js";
import { briefings, CAMPAIGN_STATUSES, campaigns, results, type CampaignStatus } from "../marketing/repo.js";
import { campaignMetrics, storeMarketing } from "../marketing/metrics.js";
import { analyzeCampaign, generatePlan } from "../marketing/strategist.js";
import { adsStatus, listMetaCampaigns, saveAdsCreds, syncMetaResults } from "../marketing/meta-ads.js";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const isDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function registerMarketing(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook("preHandler", requireAuth);
    // marketing é para quem decide a verba: administrador e dono
    r.addHook("preHandler", requireRole("admin", "dono"));

    // ───────── questionário ─────────
    r.get("/api/marketing/questionario", async (req) => {
      const storeId = storeOf(req);
      const seg = profileOf(getSettings(storeId)).id;
      const b = briefings.get(storeId);
      return {
        segmento: seg,
        secoes: questionsFor(seg),
        respostas: b.respostas,
        preenchimento: completeness(seg, b.respostas),
        atualizado_em: b.updated_at,
        atualizado_por: b.updated_by,
        produtos: vehicles.available(storeId).map((v) => ({ id: v.id, titulo: vehicleTitle(v) })),
      };
    });
    r.put("/api/marketing/questionario", async (req, reply) => {
      const body = (req.body ?? {}) as { respostas?: Record<string, unknown> };
      if (!body.respostas || typeof body.respostas !== "object") return reply.code(400).send({ erro: "Envie as respostas." });
      const storeId = storeOf(req);
      const seg = profileOf(getSettings(storeId)).id;
      const valid = new Set(questionsFor(seg).flatMap((s) => s.perguntas.map((q) => q.id)));
      const clean = Object.fromEntries(Object.entries(body.respostas).filter(([k]) => valid.has(k)));
      const b = briefings.save(storeId, { ...briefings.get(storeId).respostas, ...clean }, userOf(req).nome);
      return { ...b, preenchimento: completeness(seg, b.respostas) };
    });

    // ───────── resultados da loja ─────────
    r.get("/api/marketing/resultados", async (req) => storeMarketing(storeOf(req), Math.min(Math.max(Number((req.query as any).dias) || 30, 1), 365)));

    // ───────── campanhas ─────────
    r.get("/api/marketing/campanhas", async (req) =>
      campaigns.list(storeOf(req)).map((c) => {
        const { plano, analise, ...rest } = c;
        return { ...rest, resumo: plano?.resumo ?? null, metas: plano?.metas ?? null, nota: analise?.nota ?? null, kpis: c.status === "gerando" ? null : campaignMetrics(c).kpis };
      }),
    );

    const pedidoSchema = z.object({
      objetivo: z.enum(["leads_whatsapp", "visitas", "vendas", "marca"]),
      verba_mensal: z.number().positive(),
      inicio: isDate,
      fim: isDate.nullish(),
      canais: z.array(z.enum(["meta", "google", "tiktok"])).default(["meta"]),
      produtos: z.array(z.string()).default([]),
      observacoes: z.string().max(2000).nullish(),
    });

    r.post("/api/marketing/campanhas", async (req, reply) => {
      const p = pedidoSchema.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ erro: "Informe objetivo, verba mensal e data de início." });
      const storeId = storeOf(req);
      const produtos = p.data.produtos.filter((id) => vehicles.get(id, storeId));
      const c = campaigns.create(storeId, {
        nome: "Nova campanha",
        status: "gerando",
        pedido: { ...p.data, fim: p.data.fim ?? null, observacoes: p.data.observacoes ?? null, produtos },
      });
      void generatePlan(c.id);
      return c;
    });

    r.get("/api/marketing/campanhas/:id", async (req, reply) => {
      const c = campaigns.get(Number((req.params as any).id), storeOf(req));
      if (!c) return reply.code(404).send({ erro: "Campanha não encontrada." });
      const leads = db
        .prepare(
          `SELECT c.id, c.nome, c.nome_perfil, c.created_at, c.ad_headline, l.stage, l.temperatura, l.score, l.valor_venda
           FROM contacts c JOIN leads l ON l.contact_id = c.id WHERE c.campaign_id = ? ORDER BY c.id DESC LIMIT 300`,
        )
        .all(c.id);
      return { ...c, metricas: c.status === "gerando" ? null : campaignMetrics(c), leads };
    });

    r.patch("/api/marketing/campanhas/:id", async (req, reply) => {
      const c = campaigns.get(Number((req.params as any).id), storeOf(req));
      if (!c) return reply.code(404).send({ erro: "Campanha não encontrada." });
      const b = z
        .object({
          nome: z.string().min(1).max(120).optional(),
          status: z.enum(CAMPAIGN_STATUSES as [CampaignStatus, ...CampaignStatus[]]).optional(),
          inicio: isDate.nullish(),
          fim: isDate.nullish(),
          verba_mensal: z.number().positive().optional(),
          meta_campaign_ids: z.array(z.string().regex(/^\d+$/)).optional(),
          palavras_anuncio: z.array(z.string().max(60)).max(20).optional(),
        })
        .safeParse(req.body);
      if (!b.success) return reply.code(400).send({ erro: "Dados inválidos." });
      if (b.data.status === "gerando" || (c.status === "gerando" && b.data.status)) return reply.code(409).send({ erro: "A IA ainda está escrevendo o plano." });
      if (b.data.status === "ativa" && !c.plano) return reply.code(409).send({ erro: "A campanha precisa de um plano antes de ser ativada." });
      return campaigns.update(c.id, b.data as any);
    });

    r.post("/api/marketing/campanhas/:id/refazer", async (req, reply) => {
      const c = campaigns.get(Number((req.params as any).id), storeOf(req));
      if (!c) return reply.code(404).send({ erro: "Campanha não encontrada." });
      if (c.status === "gerando") return reply.code(409).send({ erro: "A IA já está escrevendo o plano." });
      const obs = String((req.body as any)?.observacoes ?? "").trim();
      campaigns.update(c.id, { status: "gerando", erro: null, pedido: { ...c.pedido, observacoes: [c.pedido.observacoes, obs && `Ajustes pedidos depois: ${obs}`].filter(Boolean).join("\n") || null } });
      void generatePlan(c.id);
      return { ok: true };
    });

    r.delete("/api/marketing/campanhas/:id", async (req) => {
      campaigns.remove(Number((req.params as any).id), storeOf(req));
      return { ok: true };
    });

    r.post("/api/marketing/campanhas/:id/resultados", async (req, reply) => {
      const c = campaigns.get(Number((req.params as any).id), storeOf(req));
      if (!c) return reply.code(404).send({ erro: "Campanha não encontrada." });
      const b = z
        .object({
          data: isDate.default(today()),
          investimento: z.number().min(0),
          impressoes: z.number().int().min(0).default(0),
          alcance: z.number().int().min(0).default(0),
          cliques: z.number().int().min(0).default(0),
          conversas: z.number().int().min(0).default(0),
        })
        .safeParse(req.body);
      if (!b.success) return reply.code(400).send({ erro: "Informe a data e o investimento do dia." });
      results.upsert({ ...b.data, campaign_id: c.id, store_id: c.store_id, origem: "manual" });
      return campaignMetrics(campaigns.get(c.id)!);
    });
    r.delete("/api/marketing/campanhas/:id/resultados/:data", async (req, reply) => {
      const c = campaigns.get(Number((req.params as any).id), storeOf(req));
      if (!c) return reply.code(404).send({ erro: "Campanha não encontrada." });
      results.remove(c.id, String((req.params as any).data));
      return { ok: true };
    });

    r.post("/api/marketing/campanhas/:id/analisar", async (req, reply) => {
      const c = campaigns.get(Number((req.params as any).id), storeOf(req));
      if (!c) return reply.code(404).send({ erro: "Campanha não encontrada." });
      try {
        return await analyzeCampaign(c.id);
      } catch (e) {
        return reply.code(502).send({ erro: (e as Error).message });
      }
    });

    // ───────── conta de anúncios da Meta ─────────
    r.get("/api/marketing/conta-anuncios", async (req) => adsStatus(storeOf(req)));
    r.put("/api/marketing/conta-anuncios", async (req, reply) => {
      const b = (req.body ?? {}) as { conta?: string | null; token?: string | null };
      if (b.conta && !/^(act_)?\d+$/.test(b.conta.trim())) return reply.code(400).send({ erro: "O ID da conta de anúncios tem só números (ex.: act_1234567890)." });
      saveAdsCreds(storeOf(req), b.conta?.trim() || null, typeof b.token === "string" ? b.token.trim() || null : undefined);
      return adsStatus(storeOf(req));
    });
    r.get("/api/marketing/meta/campanhas", async (req, reply) => {
      try {
        return await listMetaCampaigns(storeOf(req));
      } catch (e) {
        return reply.code(502).send({ erro: (e as Error).message });
      }
    });
    r.post("/api/marketing/meta/sincronizar", async (req, reply) => {
      try {
        return await syncMetaResults(storeOf(req), Number((req.body as any)?.dias) || 30);
      } catch (e) {
        return reply.code(502).send({ erro: (e as Error).message });
      }
    });
  });
}
