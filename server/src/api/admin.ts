import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { storeDir } from "../util/storage.js";
import { campaigns } from "../marketing/repo.js";
import { PROFILES, SEGMENTOS, profileOf, segmentDefaults, type Segmento } from "../segments.js";
import { db, nowIso } from "../db/index.js";
import {
  aiTurns,
  appointments,
  audios,
  contacts,
  events,
  leads,
  messages,
  notes,
  quickReplies,
  simulations,
  stores,
  users,
  vehicles,
  vehicleTitle,
} from "../db/repos.js";
import { getSettings, saveSettings } from "../db/settings.js";
import { LEAD_STAGES, SIMULATION_STATUSES, type Role, type Vehicle } from "../types.js";
import { bus, publish, type BusEvent } from "../util/bus.js";
import { parseCsv, parseNumberBR } from "../util/csv.js";
import { decrypt, formatCpf, maskCpf, randomPassword, verifyPassword } from "../util/crypto.js";
import { clearSessionCookie, contactFor, issueToken, requireAuth, requireRole, sellerScope, setSessionCookie, storeOf, userOf } from "./auth.js";
import { deliver, insideServiceWindow } from "../pipeline/outbox.js";
import { flush, receive, schedule } from "../pipeline/inbox.js";
import { sendConversion } from "../services/capi.js";
import { dashboardStats } from "../services/stats.js";
import { availableSlots } from "../services/schedule.js";
import { transcriptionEnabled } from "../services/transcription.js";
import { toVoiceNote } from "../services/audio.js";
import { analyzeConversation } from "../agent/analysis.js";
import { pickSeller } from "../services/handoff.js";

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const vehicleSchema = z.object({
  id: z.string().optional(),
  marca: z.string().min(1),
  modelo: z.string().min(1),
  versao: z.string().nullish(),
  ano_fab: z.number().int().nullish(),
  ano_modelo: z.number().int().nullish(),
  km: z.number().int().nullish(),
  preco: z.number().nullish(),
  preco_promocional: z.number().nullish(),
  fipe: z.number().nullish(),
  cambio: z.string().nullish(),
  combustivel: z.string().nullish(),
  carroceria: z.string().nullish(),
  cor: z.string().nullish(),
  portas: z.number().int().nullish(),
  final_placa: z.string().nullish(),
  opcionais: z.array(z.string()).optional(),
  destaques: z.array(z.string()).optional(),
  descricao: z.string().nullish(),
  fotos: z.array(z.object({ url: z.string(), legenda: z.string().optional() })).optional(),
  videos: z.array(z.object({ url: z.string(), legenda: z.string().optional() })).optional(),
  status: z.enum(["disponivel", "reservado", "vendido"]).optional(),
  destaque: z.boolean().optional(),
  entrada_sugerida: z.number().nullish(),
  ficha: z.record(z.string(), z.string()).optional(),
});

/** Código do produto: mantém o informado só se ele for livre ou já for desta loja. */
function vehicleIdFor(storeId: number, v: { id?: string | null; marca: string; modelo: string; ano_modelo?: number | null }) {
  if (v.id) {
    const ex = vehicles.get(v.id);
    if (!ex || ex.store_id === storeId) return v.id;
  }
  return newVehicleId(v);
}

function newVehicleId(v: { marca: string; modelo: string; ano_modelo?: number | null }) {
  const base = slug(`${v.marca}-${v.modelo}-${v.ano_modelo ?? ""}`) || "veiculo";
  let id = base;
  let n = 2;
  while (vehicles.get(id)) id = `${base}-${n++}`;
  return id;
}

const isManager = (req: FastifyRequest) => userOf(req).role !== "vendedor";

function simulationView(sim: ReturnType<typeof simulations.get>, revealCpf = false) {
  if (!sim) return null;
  const cpf = decrypt(sim.cpf_enc);
  const { cpf_enc: _c, ...rest } = sim;
  return { ...rest, cpf: cpf ? (revealCpf ? formatCpf(cpf) : maskCpf(cpf)) : null, tem_cpf: Boolean(cpf) };
}

function conversationPayload(req: FastifyRequest, contactId: number) {
  const c = contactFor(req, contactId);
  if (!c) return null;
  const seller = c.seller_id ? users.get(c.seller_id) : null;
  const lead = leads.get(contactId)!;
  return {
    contato: { ...c, ia_pausada: contacts.isBotPaused(c), janela_24h_aberta: insideServiceWindow(c), vendedor: seller ? { id: seller.id, nome: seller.nome } : null },
    lead,
    interesse: lead.interesse.map((id) => vehicles.get(id, c.store_id)).filter(Boolean),
    visitas: appointments.forContact(contactId),
    simulacoes: simulations.forContact(contactId).map((s) => simulationView(s)),
    notas: notes.forContact(contactId),
    mensagens: messages.forContact(contactId, 400),
    eventos: events.forContact(contactId, 60),
  };
}

export function registerAdmin(app: FastifyInstance) {
  // ───────── sessão ─────────
  const attempts = new Map<string, { n: number; until: number }>();
  app.post("/api/login", async (req, reply) => {
    const ip = req.ip;
    const a = attempts.get(ip);
    if (a && a.n >= 8 && a.until > Date.now()) return reply.code(429).send({ erro: "Muitas tentativas. Espere alguns minutos e tente de novo." });
    const { email, senha } = (req.body ?? {}) as { email?: string; senha?: string };
    const u = email ? users.byEmail(email) : null;
    if (!u || !senha || !u.ativo || !verifyPassword(senha, u.senha_hash)) {
      const cur = a && a.until > Date.now() ? a : { n: 0, until: Date.now() + 10 * 60_000 };
      attempts.set(ip, { n: cur.n + 1, until: cur.until });
      return reply.code(401).send({ erro: "E-mail ou senha incorretos." });
    }
    attempts.delete(ip);
    const token = issueToken(u.id);
    setSessionCookie(reply, token);
    events.add(u.store_id, null, "login", { email: u.email }, u.id);
    return { token };
  });
  app.post("/api/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.register(async (r) => {
    r.addHook("preHandler", requireAuth);
    const manager = requireRole("admin", "dono");
    const adminOnly = requireRole("admin");

    // ───────── quem sou eu ─────────
    r.get("/api/me", async (req) => {
      const u = userOf(req);
      const storeId = storeOf(req);
      const store = stores.get(storeId);
      const seg = (id: number) => getSettings(id).loja.segmento ?? "veiculos";
      const lojas =
        u.role === "admin"
          ? stores.all().map((s) => ({ id: s.id, nome: s.nome, ativo: s.ativo, segmento: seg(s.id) }))
          : store
            ? [{ id: store.id, nome: store.nome, ativo: store.ativo, segmento: seg(store.id) }]
            : [];
      return {
        usuario: u,
        loja_atual: store ? { id: store.id, nome: store.nome, segmento: getSettings(store.id).loja.segmento ?? "veiculos" } : null,
        lojas,
        whatsapp_configurado: Boolean(storeId && stores.creds(storeId)),
        ia: { provedor: config.ai.provider, modelo: config.ai.model, esforco: config.ai.effort },
        transcricao: transcriptionEnabled(),
        conversoes_configuradas: Boolean((store?.meta_dataset_id || config.meta.datasetId) && (store?.wa_waba_id || config.whatsapp.wabaId)),
        webhook_url: `${config.publicUrl}/webhook`,
        verify_token: u.role === "admin" ? config.whatsapp.verifyToken : undefined,
        senha_padrao: u.role === "admin" && config.admin.password === "trocar-esta-senha" && verifyPassword("trocar-esta-senha", users.byEmail(u.email)?.senha_hash),
      };
    });
    r.put("/api/me/senha", async (req, reply) => {
      const b = z.object({ atual: z.string(), nova: z.string().min(8) }).safeParse(req.body);
      if (!b.success) return reply.code(400).send({ erro: "A nova senha precisa ter pelo menos 8 caracteres." });
      const u = users.byEmail(userOf(req).email)!;
      if (!verifyPassword(b.data.atual, u.senha_hash)) return reply.code(400).send({ erro: "A senha atual está errada." });
      users.update(u.id, { senha: b.data.nova });
      return { ok: true };
    });

    // ───────── tempo real ─────────
    r.get("/api/stream", (req, reply) => {
      const storeId = storeOf(req);
      const seller = sellerScope(req);
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      reply.raw.write("retry: 3000\n\n");
      const on = (e: BusEvent) => {
        const c = contacts.get(e.contactId);
        if (!c || c.store_id !== storeId) return;
        if (seller != null && c.seller_id !== seller) return;
        reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
      };
      bus.on("event", on);
      const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
      req.raw.on("close", () => {
        bus.off("event", on);
        clearInterval(ping);
      });
    });

    // ───────── visão geral ─────────
    r.get("/api/stats", async (req) => dashboardStats(storeOf(req), Math.min(Math.max(Number((req.query as any).dias) || 7, 1), 90), sellerScope(req)));

    // ───────── conversas ─────────
    r.get("/api/conversas", async (req) => {
      const q = req.query as { q?: string; filtro?: string };
      return contacts.listWithSummary(storeOf(req), { q: q.q, filtro: q.filtro, sellerId: sellerScope(req) }).map((c: any) => ({ ...c, ia_pausada: contacts.isBotPaused(c) }));
    });
    r.get("/api/conversas/:id", async (req, reply) => conversationPayload(req, Number((req.params as any).id)) ?? reply.code(404).send({ erro: "Conversa não encontrada." }));

    r.post("/api/conversas/:id/enviar", async (req, reply) => {
      const c = contactFor(req, Number((req.params as any).id));
      if (!c) return reply.code(404).send({ erro: "Conversa não encontrada." });
      const b = z.object({ texto: z.string().min(1).max(4000), manter_ia: z.boolean().optional() }).safeParse(req.body);
      if (!b.success) return reply.code(400).send({ erro: "Escreva a mensagem." });
      if (c.channel === "whatsapp" && !insideServiceWindow(c)) return reply.code(409).send({ erro: "Passaram 24h desde a última mensagem do cliente. O WhatsApp só permite mensagem de modelo (template) agora." });
      if (!b.data.manter_ia) {
        contacts.update(c.id, { bot_paused_until: new Date(Date.now() + getSettings(c.store_id).handoff.pausar_ia_horas * 3600_000).toISOString(), paused_reason: "vendedor_assumiu" });
        publish({ type: "contact", contactId: c.id });
      }
      if (!c.seller_id && userOf(req).role !== "admin") contacts.update(c.id, { seller_id: userOf(req).id });
      const row = await deliver(contacts.get(c.id)!, { type: "text", body: b.data.texto }, "vendedor", { autor: userOf(req).nome });
      if (row.status === "failed") return reply.code(502).send({ erro: `O WhatsApp recusou a mensagem: ${(row.meta as any)?.erro ?? ""}` });
      return row;
    });
    r.post("/api/conversas/:id/audio/:audioId", async (req, reply) => {
      const c = contactFor(req, Number((req.params as any).id));
      const a = audios.get(Number((req.params as any).audioId));
      if (!c || !a || a.store_id !== c.store_id) return reply.code(404).send({ erro: "Não encontrado." });
      return deliver(c, { type: "audio", url: a.url, titulo: a.titulo }, "vendedor", { audio_id: a.id, autor: userOf(req).nome });
    });
    r.post("/api/conversas/:id/pausar", async (req, reply) => {
      const c = contactFor(req, Number((req.params as any).id));
      if (!c) return reply.code(404).send({ erro: "Conversa não encontrada." });
      const horas = Number((req.body as any)?.horas) || getSettings(c.store_id).handoff.pausar_ia_horas;
      contacts.update(c.id, { bot_paused_until: new Date(Date.now() + horas * 3600_000).toISOString(), paused_reason: "pausado_no_painel" });
      if (!c.seller_id && userOf(req).role === "vendedor") contacts.update(c.id, { seller_id: userOf(req).id });
      publish({ type: "contact", contactId: c.id });
      return { ok: true };
    });
    r.post("/api/conversas/:id/retomar", async (req, reply) => {
      const c = contactFor(req, Number((req.params as any).id));
      if (!c) return reply.code(404).send({ erro: "Conversa não encontrada." });
      contacts.update(c.id, { bot_paused_until: null, paused_reason: null });
      publish({ type: "contact", contactId: c.id });
      const pend = messages.forContact(c.id, 20, c.ai_cursor).filter((m) => m.direction === "in");
      if ((req.body as any)?.responder && pend.length) schedule(c.id, 500);
      return { ok: true, pendentes: pend.length };
    });
    r.patch("/api/conversas/:id", async (req, reply) => {
      const c = contactFor(req, Number((req.params as any).id));
      if (!c) return reply.code(404).send({ erro: "Conversa não encontrada." });
      const b = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (typeof b.nome === "string") patch.nome = b.nome;
      if (Array.isArray(b.tags)) patch.tags = (b.tags as unknown[]).map(String).map((t) => t.trim()).filter(Boolean).slice(0, 12);
      if (typeof b.opt_out === "boolean") patch.opt_out = b.opt_out;
      if ("campaign_id" in b) {
        const camp = b.campaign_id == null ? null : campaigns.get(Number(b.campaign_id), c.store_id);
        if (b.campaign_id != null && !camp) return reply.code(400).send({ erro: "Campanha inválida." });
        patch.campaign_id = camp?.id ?? null;
      }
      if ("seller_id" in b) {
        const target = b.seller_id == null ? null : users.get(Number(b.seller_id));
        if (b.seller_id != null && (!target || target.store_id !== c.store_id)) return reply.code(400).send({ erro: "Vendedor inválido." });
        if (userOf(req).role === "vendedor" && target && target.id !== userOf(req).id) {
          // vendedor pode passar o lead dele para um colega
          events.add(c.store_id, c.id, "lead_transferido", { de: userOf(req).nome, para: target.nome }, userOf(req).id);
        }
        patch.seller_id = target?.id ?? null;
        if (target) events.add(c.store_id, c.id, "lead_atribuido", { seller_id: target.id, nome: target.nome, por: userOf(req).nome }, userOf(req).id);
      }
      contacts.update(c.id, patch as any);
      publish({ type: "contact", contactId: c.id });
      return { ok: true };
    });
    r.post("/api/conversas/:id/notas", async (req, reply) => {
      const c = contactFor(req, Number((req.params as any).id));
      const texto = String((req.body as any)?.texto ?? "").trim();
      if (!c || !texto) return reply.code(400).send({ erro: "Escreva a nota." });
      const n = notes.add(c.id, userOf(req).id, userOf(req).nome, texto.slice(0, 2000));
      publish({ type: "contact", contactId: c.id });
      return n;
    });
    r.delete("/api/conversas/:id/notas/:nota", async (req, reply) => {
      const c = contactFor(req, Number((req.params as any).id));
      if (!c) return reply.code(404).send({ erro: "Conversa não encontrada." });
      notes.remove(Number((req.params as any).nota), c.id);
      return { ok: true };
    });
    r.post("/api/conversas/:id/analisar", async (req, reply) => {
      const c = contactFor(req, Number((req.params as any).id));
      if (!c) return reply.code(404).send({ erro: "Conversa não encontrada." });
      try {
        return await analyzeConversation(c.id);
      } catch (e) {
        return reply.code(502).send({ erro: (e as Error).message });
      }
    });
    r.delete("/api/conversas/:id/historico-ia", { preHandler: manager }, async (req) => {
      const c = contactFor(req, Number((req.params as any).id));
      if (c) aiTurns.endSessions(c.id);
      return { ok: true };
    });

    // ───────── leads ─────────
    r.get("/api/leads", async (req) =>
      leads.board(storeOf(req), sellerScope(req)).map((l: any) => ({
        ...l,
        veiculos: l.interesse.map((id: string) => vehicles.get(id, l.store_id)).filter(Boolean).map((v: Vehicle) => ({ id: v.id, titulo: vehicleTitle(v), foto: v.fotos[0]?.url ?? null })),
      })),
    );
    r.patch("/api/leads/:id", async (req, reply) => {
      const c = contactFor(req, Number((req.params as any).id));
      if (!c) return reply.code(404).send({ erro: "Lead não encontrado." });
      const b = z
        .object({
          stage: z.enum(LEAD_STAGES as [string, ...string[]]).optional(),
          valor_venda: z.number().nullish(),
          vehicle_sold_id: z.string().nullish(),
          motivo_perda: z.string().nullish(),
          observacoes: z.string().nullish(),
        })
        .safeParse(req.body);
      if (!b.success) return reply.code(400).send({ erro: "Dados inválidos." });
      const cur = leads.get(c.id)!;
      const updated = leads.update(c.id, b.data as any)!;
      if (b.data.stage === "vendido" && cur.stage !== "vendido") {
        const valor = b.data.valor_venda ?? cur.valor_venda ?? null;
        events.add(c.store_id, c.id, "venda", { valor, veiculo_id: b.data.vehicle_sold_id ?? null }, userOf(req).id);
        if (b.data.vehicle_sold_id) vehicles.setStatus(b.data.vehicle_sold_id, "vendido", c.store_id);
        void sendConversion(c.id, "venda", { value: valor ?? undefined });
      }
      if (b.data.stage === "perdido" && cur.stage !== "perdido") events.add(c.store_id, c.id, "lead_perdido", { motivo: b.data.motivo_perda ?? "painel" }, userOf(req).id);
      publish({ type: "lead", contactId: c.id });
      return updated;
    });
    r.get("/api/leads/exportar", async (req, reply) => {
      const rows = leads.board(storeOf(req), sellerScope(req));
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const head = ["Nome", "Telefone", "Etapa", "Temperatura", "Pontos", "Intenção", "Interesse", "Pagamento", "Entrada", "Troca", "Vendedor", "Origem", "Anúncio", "Última mensagem"];
      const lines = rows.map((l: any) =>
        [
          l.nome || l.nome_perfil,
          l.wa_id,
          l.stage,
          l.temperatura,
          l.score,
          l.intencao,
          l.interesse.map((id: string) => vehicles.get(id, l.store_id)).filter(Boolean).map((v: Vehicle) => vehicleTitle(v)).join("; ") || l.interesse_texto,
          l.forma_pagamento,
          l.entrada,
          l.tem_troca ? [l.troca?.modelo, l.troca?.ano].filter(Boolean).join(" ") : "",
          l.vendedor,
          l.origem,
          l.ad_headline,
          l.last_at,
        ]
          .map(esc)
          .join(";"),
      );
      reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
      return "﻿" + [head.map(esc).join(";"), ...lines].join("\n");
    });

    // ───────── simulações ─────────
    r.get("/api/simulacoes", async (req) => simulations.list(storeOf(req), sellerScope(req)).map((s: any) => ({ ...simulationView(s), contato_nome: s.contato_nome, nome_perfil: s.nome_perfil, wa_id: s.wa_id, vendedor: s.vendedor, veiculo: s.marca ? `${s.marca} ${s.modelo} ${s.versao ?? ""} ${s.ano_modelo ?? ""}`.trim() : null })));
    r.post("/api/simulacoes/:id/revelar-cpf", async (req, reply) => {
      const s = simulations.get(Number((req.params as any).id));
      if (!s || !contactFor(req, s.contact_id)) return reply.code(404).send({ erro: "Simulação não encontrada." });
      events.add(s.store_id, s.contact_id, "cpf_visualizado", { simulation_id: s.id }, userOf(req).id);
      return { cpf: decrypt(s.cpf_enc) ? formatCpf(decrypt(s.cpf_enc)!) : null };
    });
    r.patch("/api/simulacoes/:id", async (req, reply) => {
      const s = simulations.get(Number((req.params as any).id));
      if (!s || !contactFor(req, s.contact_id)) return reply.code(404).send({ erro: "Simulação não encontrada." });
      const b = z
        .object({ status: z.enum(SIMULATION_STATUSES as [string, ...string[]]).optional(), resultado: z.string().nullish(), observacoes: z.string().nullish(), seller_id: z.number().nullish() })
        .safeParse(req.body);
      if (!b.success) return reply.code(400).send({ erro: "Dados inválidos." });
      if (b.data.seller_id != null) {
        const t = users.get(b.data.seller_id);
        if (!t || t.store_id !== s.store_id) return reply.code(400).send({ erro: "Vendedor inválido." });
      }
      const upd = simulations.update(s.id, b.data as any)!;
      if (b.data.status && b.data.status !== s.status) {
        events.add(s.store_id, s.contact_id, `simulacao_${b.data.status}`, { simulation_id: s.id }, userOf(req).id);
        if (b.data.status === "aprovada") leads.update(s.contact_id, { stage: "negociacao" });
      }
      publish({ type: "lead", contactId: s.contact_id });
      return simulationView(upd);
    });

    // ───────── estoque ─────────
    r.get("/api/veiculos", async (req) => vehicles.all(storeOf(req)));
    r.post("/api/veiculos", { preHandler: manager }, async (req, reply) => {
      const p = vehicleSchema.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ erro: "Confira os campos do veículo.", detalhes: p.error.issues });
      return vehicles.upsert({ ...(p.data as any), id: vehicleIdFor(storeOf(req), p.data), store_id: storeOf(req) });
    });
    r.put("/api/veiculos/:id", async (req, reply) => {
      const v = vehicles.get((req.params as any).id, storeOf(req));
      if (!v) return reply.code(404).send({ erro: "Veículo não encontrado." });
      const p = vehicleSchema.partial().safeParse(req.body);
      if (!p.success) return reply.code(400).send({ erro: "Confira os campos do veículo." });
      // vendedor só muda a situação (disponível/reservado/vendido)
      const data = isManager(req) ? p.data : { status: p.data.status };
      return vehicles.upsert({ ...v, ...(data as any), id: v.id, store_id: v.store_id });
    });
    r.delete("/api/veiculos/:id", { preHandler: manager }, async (req) => {
      const v = vehicles.get((req.params as any).id, storeOf(req));
      if (v) vehicles.remove(v.id, v.store_id);
      return { ok: true };
    });
    r.post("/api/veiculos/importar", { preHandler: manager }, async (req, reply) => {
      const { csv } = (req.body ?? {}) as { csv?: string };
      if (!csv) return reply.code(400).send({ erro: "Envie o conteúdo do CSV." });
      const storeId = storeOf(req);
      const perfil = profileOf(getSettings(storeId));
      let n = 0;
      const erros: string[] = [];
      for (const [i, r0] of parseCsv(csv).entries()) {
        if (!r0.marca || !r0.modelo) {
          erros.push(`Linha ${i + 2}: faltou marca ou modelo`);
          continue;
        }
        const anoModelo = parseNumberBR(r0.ano_modelo || r0.ano);
        const urls = (s?: string) => (s || "").split(/[|\s]+/).map((u) => u.trim()).filter((u) => /^https?:\/\/|^\//.test(u)).map((url) => ({ url }));
        vehicles.upsert({
          id: vehicleIdFor(storeId, { id: r0.id || null, marca: r0.marca, modelo: r0.modelo, ano_modelo: anoModelo }),
          store_id: storeId,
          marca: r0.marca,
          modelo: r0.modelo,
          versao: r0.versao || null,
          ano_fab: parseNumberBR(r0.ano_fab || r0.ano_fabricacao) ?? anoModelo,
          ano_modelo: anoModelo,
          km: parseNumberBR(r0.km),
          preco: parseNumberBR(r0.preco || r0.valor),
          preco_promocional: parseNumberBR(r0.preco_promocional),
          fipe: parseNumberBR(r0.fipe),
          cambio: r0.cambio || null,
          combustivel: r0.combustivel || null,
          carroceria: r0.carroceria || r0.categoria || null,
          cor: r0.cor || null,
          portas: parseNumberBR(r0.portas),
          final_placa: r0.final_placa || null,
          opcionais: (r0.opcionais || "").split(/[;|]/).map((s) => s.trim()).filter(Boolean),
          destaques: (r0.destaques || "").split(/[;|]/).map((s) => s.trim()).filter(Boolean),
          descricao: r0.descricao || null,
          fotos: urls(r0.fotos),
          videos: urls(r0.videos),
          status: (["disponivel", "reservado", "vendido"].includes(r0.status) ? r0.status : "disponivel") as Vehicle["status"],
          entrada_sugerida: parseNumberBR(r0.entrada_sugerida || r0.entrada),
          ficha: Object.fromEntries(perfil.ficha.filter((f) => r0[f.chave]).map((f) => [f.chave, String(r0[f.chave])])),
        } as any);
        n++;
      }
      return { importados: n, erros };
    });

    // ───────── arquivos (fotos, vídeos, áudios) ─────────
    r.post("/api/uploads", { preHandler: manager }, async (req, reply) => {
      const file = await (req as any).file();
      if (!file) return reply.code(400).send({ erro: "Nenhum arquivo enviado." });
      const ext = (path.extname(file.filename || "").toLowerCase() || ".jpg").replace(/[^.a-z0-9]/g, "");
      if (![".jpg", ".jpeg", ".png", ".webp", ".mp4"].includes(ext)) return reply.code(400).send({ erro: "Use foto JPG, PNG ou WEBP, ou vídeo MP4 (até 16 MB)." });
      const buf = await file.toBuffer();
      if (ext === ".mp4" && buf.length > 16 * 1024 * 1024) return reply.code(400).send({ erro: "O WhatsApp aceita vídeos de até 16 MB. Comprima o vídeo e tente de novo." });
      const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      const dir = storeDir("uploads", storeOf(req));
      await fs.promises.writeFile(path.join(config.dataDir, "uploads", dir, name), buf);
      return { url: `/uploads/${dir}/${name}` };
    });

    r.get("/api/audios", async (req) => audios.forStore(storeOf(req)));
    r.post("/api/audios", { preHandler: manager }, async (req, reply) => {
      const parts = (req as any).parts();
      const fields: Record<string, string> = {};
      let saved: { url: string; mime: string; duracao: number | null } | null = null;
      for await (const part of parts) {
        if (part.type === "file") {
          const ext = (path.extname(part.filename || "").toLowerCase() || ".ogg").replace(/[^.a-z0-9]/g, "");
          if (![".ogg", ".opus", ".mp3", ".m4a", ".aac", ".wav", ".amr", ".webm"].includes(ext)) return reply.code(400).send({ erro: "Formato de áudio não aceito. Use OGG, MP3, M4A ou WAV." });
          const dir = storeDir("uploads", storeOf(req));
          const base = `${dir}/audio-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
          const tmp = path.join(config.dataDir, "uploads", `${base}-orig${ext}`);
          await fs.promises.writeFile(tmp, await part.toBuffer());
          const out = path.join(config.dataDir, "uploads", `${base}.ogg`);
          const conv = await toVoiceNote(tmp, out);
          if (conv.ok) {
            fs.unlinkSync(tmp);
            saved = { url: `/uploads/${base}.ogg`, mime: "audio/ogg", duracao: conv.duracao };
          } else saved = { url: `/uploads/${base}-orig${ext}`, mime: ext === ".mp3" ? "audio/mpeg" : ext === ".m4a" ? "audio/mp4" : "audio/ogg", duracao: null };
        } else fields[part.fieldname] = String(part.value ?? "");
      }
      if (!saved || !fields.titulo || !fields.quando_usar) return reply.code(400).send({ erro: "Envie o áudio, um título e quando a IA deve usar." });
      return audios.create({ store_id: storeOf(req), titulo: fields.titulo.slice(0, 80), quando_usar: fields.quando_usar.slice(0, 300), url: saved.url, mime: saved.mime, duracao_s: saved.duracao });
    });
    r.put("/api/audios/:id", { preHandler: manager }, async (req, reply) => {
      const a = audios.get(Number((req.params as any).id));
      if (!a || a.store_id !== storeOf(req)) return reply.code(404).send({ erro: "Áudio não encontrado." });
      return audios.update(a.id, req.body as any);
    });
    r.delete("/api/audios/:id", { preHandler: manager }, async (req) => {
      const a = audios.get(Number((req.params as any).id));
      if (a && a.store_id === storeOf(req)) audios.remove(a.id);
      return { ok: true };
    });

    // ───────── respostas rápidas ─────────
    r.get("/api/respostas-rapidas", async (req) => quickReplies.forStore(storeOf(req)));
    r.post("/api/respostas-rapidas", { preHandler: manager }, async (req, reply) => {
      const b = z.object({ atalho: z.string().min(1).max(40), texto: z.string().min(1).max(2000) }).safeParse(req.body);
      if (!b.success) return reply.code(400).send({ erro: "Preencha o atalho e o texto." });
      return quickReplies.create(storeOf(req), b.data.atalho, b.data.texto);
    });
    r.delete("/api/respostas-rapidas/:id", { preHandler: manager }, async (req) => {
      quickReplies.remove(Number((req.params as any).id), storeOf(req));
      return { ok: true };
    });

    // ───────── agenda ─────────
    r.get("/api/agenda", async (req) => {
      const q = req.query as { de?: string; ate?: string };
      const de = q.de ? new Date(q.de).toISOString() : new Date(Date.now() - 86400_000).toISOString();
      const ate = q.ate ? new Date(q.ate).toISOString() : new Date(Date.now() + 15 * 86400_000).toISOString();
      return appointments.between(storeOf(req), de, ate, sellerScope(req));
    });
    r.get("/api/agenda/horarios", async (req) => availableSlots(storeOf(req), getSettings(storeOf(req)), { limite: 30 }));
    r.patch("/api/agenda/:id", async (req, reply) => {
      const a0 = appointments.get(Number((req.params as any).id));
      if (!a0 || !contactFor(req, a0.contact_id)) return reply.code(404).send({ erro: "Agendamento não encontrado." });
      const b = (req.body ?? {}) as Record<string, any>;
      const a = appointments.update(a0.id, {
        ...(b.status ? { status: b.status } : {}),
        ...(b.inicio ? { inicio: new Date(b.inicio).toISOString(), reminder_sent: false } : {}),
        ...(b.notas !== undefined ? { notas: b.notas } : {}),
      })!;
      if (b.status === "realizada") events.add(a.store_id, a.contact_id, "visita_realizada", { id: a.id }, userOf(req).id);
      if (b.status === "faltou") events.add(a.store_id, a.contact_id, "visita_faltou", { id: a.id }, userOf(req).id);
      publish({ type: "appointment", contactId: a.contact_id, appointmentId: a.id });
      return a;
    });

    // ───────── equipe ─────────
    r.get("/api/equipe", async (req) => users.forStore(storeOf(req)));
    r.post("/api/equipe", { preHandler: manager }, async (req, reply) => {
      const b = z
        .object({ nome: z.string().min(1), email: z.string().min(3), role: z.enum(["dono", "vendedor"]), whatsapp: z.string().nullish(), recebe_leads: z.boolean().optional(), senha: z.string().min(8).optional() })
        .safeParse(req.body);
      if (!b.success) return reply.code(400).send({ erro: "Informe nome, e-mail e o tipo de acesso." });
      if (users.byEmail(b.data.email)) return reply.code(409).send({ erro: "Já existe alguém com esse e-mail." });
      const senha = b.data.senha || randomPassword();
      const u = users.create({
        store_id: storeOf(req),
        role: b.data.role,
        nome: b.data.nome,
        email: b.data.email,
        senha,
        whatsapp: b.data.whatsapp?.replace(/\D/g, "") || null,
        recebe_leads: b.data.recebe_leads ?? b.data.role === "vendedor",
      });
      return { ...u, senha_inicial: senha };
    });
    r.put("/api/equipe/:id", { preHandler: manager }, async (req, reply) => {
      const u = users.get(Number((req.params as any).id));
      if (!u || u.store_id !== storeOf(req)) return reply.code(404).send({ erro: "Pessoa não encontrada." });
      const b = (req.body ?? {}) as Record<string, any>;
      const patch: Record<string, unknown> = {};
      for (const k of ["nome", "email", "ativo", "recebe_leads"]) if (k in b) patch[k] = b[k];
      if ("whatsapp" in b) patch.whatsapp = b.whatsapp ? String(b.whatsapp).replace(/\D/g, "") : null;
      if (b.role && ["dono", "vendedor"].includes(b.role)) patch.role = b.role as Role;
      let senha: string | undefined;
      if (b.nova_senha) senha = randomPassword();
      const upd = users.update(u.id, { ...(patch as any), ...(senha ? { senha } : {}) });
      return { ...upd, ...(senha ? { senha_inicial: senha } : {}) };
    });
    r.delete("/api/equipe/:id", { preHandler: manager }, async (req, reply) => {
      const u = users.get(Number((req.params as any).id));
      if (!u || u.store_id !== storeOf(req) || u.id === userOf(req).id) return reply.code(400).send({ erro: "Não é possível remover." });
      users.remove(u.id);
      return { ok: true };
    });

    // ───────── lojas (admin) ─────────
    r.get("/api/lojas", { preHandler: adminOnly }, async () =>
      stores.all().map((s) => ({
        ...s,
        wa_access_token: undefined,
        token_configurado: Boolean(s.wa_access_token),
        whatsapp_ok: Boolean(stores.creds(s.id)),
        segmento: getSettings(s.id).loja.segmento ?? "veiculos",
        contatos: Number((db.prepare("SELECT COUNT(*) n FROM contacts WHERE store_id = ?").get(s.id) as any).n),
        veiculos: Number((db.prepare("SELECT COUNT(*) n FROM vehicles WHERE store_id = ? AND status != 'vendido'").get(s.id) as any).n),
      })),
    );
    r.post("/api/lojas", { preHandler: adminOnly }, async (req, reply) => {
      const nome = String((req.body as any)?.nome ?? "").trim();
      if (!nome) return reply.code(400).send({ erro: "Informe o nome da loja." });
      const segmento = SEGMENTOS.includes((req.body as any)?.segmento) ? ((req.body as any).segmento as Segmento) : "veiculos";
      let sl = slug(nome) || "loja";
      let n = 2;
      while (stores.bySlug(sl)) sl = `${slug(nome)}-${n++}`;
      const s = stores.create(nome, sl);
      saveSettings(s.id, segmentDefaults(segmento));
      saveSettings(s.id, { loja: { nome } });
      return { ...s, segmento };
    });
    r.put("/api/lojas/:id", { preHandler: adminOnly }, async (req, reply) => {
      const id = Number((req.params as any).id);
      const b = (req.body ?? {}) as Record<string, any>;
      if (b.wa_phone_number_id) {
        const other = stores.byPhoneNumberId(b.wa_phone_number_id);
        if (other && other.id !== id) return reply.code(409).send({ erro: `Esse número já está na loja ${other.nome}.` });
      }
      const s = stores.update(id, {
        nome: b.nome,
        ativo: b.ativo,
        wa_phone_number_id: b.wa_phone_number_id,
        wa_waba_id: b.wa_waba_id,
        meta_dataset_id: b.meta_dataset_id,
        ...(typeof b.wa_access_token === "string" ? { wa_access_token_plain: b.wa_access_token } : {}),
      });
      if (!s) return reply.code(404).send({ erro: "Loja não encontrada." });
      if (b.nome) saveSettings(id, { loja: { nome: b.nome } });
      if (SEGMENTOS.includes(b.segmento)) saveSettings(id, { loja: { segmento: b.segmento, tipo_loja: PROFILES[b.segmento as Segmento].tipo_loja } });
      return { ...s, wa_access_token: undefined, token_configurado: Boolean(s.wa_access_token) };
    });
    r.delete("/api/lojas/:id", { preHandler: adminOnly }, async (req) => {
      stores.remove(Number((req.params as any).id));
      return { ok: true };
    });

    // ───────── configurações ─────────
    r.get("/api/config", async (req) => getSettings(storeOf(req)));
    r.put("/api/config", { preHandler: manager }, async (req) => {
      const body = { ...((req.body ?? {}) as Record<string, any>) };
      // o segmento da loja só o administrador muda (em Lojas)
      if (userOf(req).role !== "admin" && body.loja && typeof body.loja === "object") {
        const { segmento: _s, ...loja } = body.loja;
        body.loja = loja;
      }
      if (body.loja?.segmento && !SEGMENTOS.includes(body.loja.segmento)) delete body.loja.segmento;
      return saveSettings(storeOf(req), body);
    });

    // ───────── simulador ─────────
    r.post("/api/simulador/mensagem", { preHandler: manager }, async (req, reply) => {
      const b = z
        .object({
          telefone: z.string().default("5521900000000"),
          nome: z.string().default("Cliente Teste"),
          texto: z.string().optional(),
          botao: z.object({ id: z.string(), title: z.string() }).optional(),
          imagem_base64: z.string().optional(),
          mime: z.string().optional(),
          anuncio: z.object({ headline: z.string(), body: z.string().optional(), ctwa_clid: z.string().optional() }).optional(),
          aguardar: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!b.success) return reply.code(400).send({ erro: "Mensagem inválida." });
      const d = b.data;
      const storeId = storeOf(req);
      const waId = `sim${d.telefone.replace(/\D/g, "")}`;
      const row = await receive({
        storeId,
        channel: "simulador",
        waId,
        profileName: d.nome,
        waMessageId: `simin-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        timestamp: new Date(),
        type: d.botao ? "interactive" : d.imagem_base64 ? "image" : "text",
        text: d.texto ?? null,
        caption: d.imagem_base64 ? d.texto ?? null : null,
        interactive: d.botao ?? null,
        mediaData: d.imagem_base64 ? { data: Buffer.from(d.imagem_base64, "base64"), mime: d.mime ?? "image/jpeg" } : null,
        referral: d.anuncio ? { headline: d.anuncio.headline, body: d.anuncio.body, ctwa_clid: d.anuncio.ctwa_clid ?? `sim-clid-${Date.now()}`, source_type: "ad", source_id: "sim-ad" } : null,
      });
      const contact = contacts.byWaId(storeId, waId)!;
      if (d.aguardar) await flush(contact.id);
      return { contato_id: contact.id, mensagem: row };
    });
    r.post("/api/simulador/limpar", { preHandler: manager }, async (req) => {
      const telefone = String((req.body as any)?.telefone ?? "5521900000000");
      const c = contacts.byWaId(storeOf(req), `sim${telefone.replace(/\D/g, "")}`);
      if (c) contacts.remove(c.id);
      return { ok: true };
    });

    r.get("/api/eventos", { preHandler: manager }, async (req) =>
      db.prepare("SELECT e.*, c.nome, c.nome_perfil FROM events e LEFT JOIN contacts c ON c.id = e.contact_id WHERE e.store_id = ? ORDER BY e.id DESC LIMIT 200").all(storeOf(req)),
    );
    r.post("/api/conversas/:id/atribuir-a-mim", async (req, reply) => {
      const c = contacts.get(Number((req.params as any).id));
      if (!c || c.store_id !== storeOf(req)) return reply.code(404).send({ erro: "Conversa não encontrada." });
      if (c.seller_id && userOf(req).role === "vendedor") return reply.code(409).send({ erro: "Esse lead já tem vendedor." });
      contacts.update(c.id, { seller_id: userOf(req).id });
      events.add(c.store_id, c.id, "lead_atribuido", { seller_id: userOf(req).id, nome: userOf(req).nome }, userOf(req).id);
      publish({ type: "contact", contactId: c.id });
      return { ok: true, em: nowIso() };
    });
    void pickSeller;
  });
}
