import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config, isWhatsAppConfigured } from "../config.js";
import { db, nowIso } from "../db/index.js";
import { aiTurns, appointments, contacts, events, leads, messages, sellers, vehicles, vehicleTitle } from "../db/repos.js";
import { getSettings, saveSettings } from "../db/settings.js";
import { LEAD_STAGES, type Vehicle } from "../types.js";
import { bus, publish, type BusEvent } from "../util/bus.js";
import { parseCsv, parseNumberBR } from "../util/csv.js";
import { checkPassword, clearSessionCookie, issueToken, requireAuth, setSessionCookie } from "./auth.js";
import { deliver, insideServiceWindow } from "../pipeline/outbox.js";
import { flush, receive, schedule } from "../pipeline/inbox.js";
import { sendConversion } from "../services/capi.js";
import { dashboardStats } from "../services/stats.js";
import { availableSlots } from "../services/schedule.js";
import { transcriptionEnabled } from "../services/transcription.js";

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
  status: z.enum(["disponivel", "reservado", "vendido"]).optional(),
  destaque: z.boolean().optional(),
  entrada_sugerida: z.number().nullish(),
});

function newVehicleId(v: { marca: string; modelo: string; ano_modelo?: number | null }) {
  const base = slug(`${v.marca}-${v.modelo}-${v.ano_modelo ?? ""}`) || "veiculo";
  let id = base;
  let n = 2;
  while (vehicles.get(id)) id = `${base}-${n++}`;
  return id;
}

function conversationPayload(contactId: number) {
  const c = contacts.get(contactId);
  if (!c) return null;
  const seller = c.seller_id ? sellers.get(c.seller_id) : null;
  return {
    contato: { ...c, ia_pausada: contacts.isBotPaused(c), janela_24h_aberta: insideServiceWindow(c), vendedor: seller },
    lead: leads.get(contactId),
    interesse: (leads.get(contactId)?.interesse ?? []).map((id) => vehicles.get(id)).filter(Boolean),
    visitas: appointments.forContact(contactId),
    mensagens: messages.forContact(contactId, 400),
    eventos: db.prepare("SELECT * FROM events WHERE contact_id = ? ORDER BY id DESC LIMIT 50").all(contactId),
  };
}

export function registerAdmin(app: FastifyInstance) {
  // ───────── sessão ─────────
  const attempts = new Map<string, { n: number; until: number }>();
  app.post("/api/login", async (req, reply) => {
    const ip = req.ip;
    const a = attempts.get(ip);
    if (a && a.n >= 8 && a.until > Date.now()) return reply.code(429).send({ erro: "Muitas tentativas. Espere alguns minutos e tente de novo." });
    const { senha } = (req.body ?? {}) as { senha?: string };
    if (!senha || !checkPassword(senha)) {
      const cur = a && a.until > Date.now() ? a : { n: 0, until: Date.now() + 10 * 60_000 };
      attempts.set(ip, { n: cur.n + 1, until: cur.until });
      return reply.code(401).send({ erro: "Senha incorreta." });
    }
    attempts.delete(ip);
    const token = issueToken();
    setSessionCookie(reply, token);
    return { token };
  });
  app.post("/api/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.register(async (r) => {
    r.addHook("preHandler", requireAuth);

    r.get("/api/me", async () => ({
      ok: true,
      loja: getSettings().loja.nome,
      whatsapp_configurado: isWhatsAppConfigured(),
      ia: { provedor: config.ai.provider, modelo: config.ai.model, esforco: config.ai.effort },
      transcricao: transcriptionEnabled(),
      conversoes_configuradas: Boolean(config.meta.datasetId && config.whatsapp.wabaId),
      webhook_url: `${config.publicUrl}/webhook`,
      senha_padrao: config.admin.password === "trocar-esta-senha",
    }));

    // ───────── tempo real (SSE) ─────────
    r.get("/api/stream", (req, reply) => {
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      reply.raw.write("retry: 3000\n\n");
      const on = (e: BusEvent) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
      bus.on("event", on);
      const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
      req.raw.on("close", () => {
        bus.off("event", on);
        clearInterval(ping);
      });
    });

    // ───────── visão geral ─────────
    r.get("/api/stats", async (req) => {
      const dias = Math.min(Math.max(Number((req.query as any).dias) || 7, 1), 90);
      return dashboardStats(dias);
    });

    // ───────── conversas ─────────
    r.get("/api/conversas", async (req) => {
      const q = req.query as { q?: string; filtro?: string };
      return contacts.listWithSummary({ q: q.q, filtro: q.filtro }).map((c: any) => ({ ...c, ia_pausada: contacts.isBotPaused(c) }));
    });
    r.get("/api/conversas/:id", async (req, reply) => {
      const p = conversationPayload(Number((req.params as any).id));
      return p ?? reply.code(404).send({ erro: "Conversa não encontrada." });
    });
    r.get("/api/mensagens/:id", async (req, reply) => {
      const m = messages.get(Number((req.params as any).id));
      return m ?? reply.code(404).send({ erro: "Mensagem não encontrada." });
    });

    r.post("/api/conversas/:id/enviar", async (req, reply) => {
      const id = Number((req.params as any).id);
      const body = z.object({ texto: z.string().min(1).max(4000), manter_ia: z.boolean().optional() }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ erro: "Escreva a mensagem." });
      const c = contacts.get(id);
      if (!c) return reply.code(404).send({ erro: "Conversa não encontrada." });
      if (c.channel === "whatsapp" && !insideServiceWindow(c)) {
        return reply.code(409).send({ erro: "Passaram 24h desde a última mensagem do cliente. O WhatsApp só permite mensagem de modelo (template) agora." });
      }
      if (!body.data.manter_ia) {
        const until = new Date(Date.now() + getSettings().handoff.pausar_ia_horas * 3600_000).toISOString();
        contacts.update(id, { bot_paused_until: until, paused_reason: "vendedor_assumiu" });
        publish({ type: "contact", contactId: id });
      }
      const row = await deliver(contacts.get(id)!, { type: "text", body: body.data.texto }, "vendedor");
      if (row.status === "failed") return reply.code(502).send({ erro: `O WhatsApp recusou a mensagem: ${(row.meta as any)?.erro ?? ""}` });
      return row;
    });

    r.post("/api/conversas/:id/pausar", async (req) => {
      const id = Number((req.params as any).id);
      const horas = Number((req.body as any)?.horas) || getSettings().handoff.pausar_ia_horas;
      contacts.update(id, { bot_paused_until: new Date(Date.now() + horas * 3600_000).toISOString(), paused_reason: "pausado_no_painel" });
      publish({ type: "contact", contactId: id });
      return { ok: true };
    });
    r.post("/api/conversas/:id/retomar", async (req) => {
      const id = Number((req.params as any).id);
      contacts.update(id, { bot_paused_until: null, paused_reason: null });
      publish({ type: "contact", contactId: id });
      // se o cliente mandou algo enquanto estava pausado, a IA responde agora
      const c = contacts.get(id)!;
      const pend = messages.forContact(id, 20, c.ai_cursor).filter((m) => m.direction === "in");
      if ((req.body as any)?.responder && pend.length) schedule(id, 500);
      return { ok: true, pendentes: pend.length };
    });
    r.patch("/api/conversas/:id", async (req) => {
      const id = Number((req.params as any).id);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (typeof b.nome === "string") patch.nome = b.nome;
      if ("seller_id" in b) patch.seller_id = b.seller_id == null ? null : Number(b.seller_id);
      if (typeof b.opt_out === "boolean") patch.opt_out = b.opt_out;
      contacts.update(id, patch as any);
      publish({ type: "contact", contactId: id });
      return conversationPayload(id);
    });

    // ───────── leads ─────────
    r.get("/api/leads", async () =>
      leads.board().map((l: any) => ({
        ...l,
        veiculos: l.interesse.map((id: string) => vehicles.get(id)).filter(Boolean).map((v: Vehicle) => ({ id: v.id, titulo: vehicleTitle(v), foto: v.fotos[0]?.url ?? null })),
        vendedor: l.seller_id ? sellers.get(l.seller_id)?.nome ?? null : null,
      })),
    );
    r.patch("/api/leads/:id", async (req, reply) => {
      const id = Number((req.params as any).id);
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
      const cur = leads.get(id);
      if (!cur) return reply.code(404).send({ erro: "Lead não encontrado." });
      const updated = leads.update(id, b.data as any)!;
      if (b.data.stage === "vendido" && cur.stage !== "vendido") {
        const valor = b.data.valor_venda ?? cur.valor_venda ?? null;
        events.add(id, "venda", { valor, veiculo_id: b.data.vehicle_sold_id ?? null });
        if (b.data.vehicle_sold_id) vehicles.setStatus(b.data.vehicle_sold_id, "vendido");
        void sendConversion(id, "venda", { value: valor ?? undefined });
      }
      if (b.data.stage === "perdido" && cur.stage !== "perdido") events.add(id, "lead_perdido", { motivo: b.data.motivo_perda ?? "painel" });
      publish({ type: "lead", contactId: id });
      return updated;
    });

    // ───────── estoque ─────────
    r.get("/api/veiculos", async () => vehicles.all());
    r.post("/api/veiculos", async (req, reply) => {
      const p = vehicleSchema.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ erro: "Confira os campos do veículo.", detalhes: p.error.issues });
      const id = p.data.id || newVehicleId(p.data);
      return vehicles.upsert({ ...(p.data as any), id });
    });
    r.put("/api/veiculos/:id", async (req, reply) => {
      const id = (req.params as any).id as string;
      if (!vehicles.get(id)) return reply.code(404).send({ erro: "Veículo não encontrado." });
      const p = vehicleSchema.partial().safeParse(req.body);
      if (!p.success) return reply.code(400).send({ erro: "Confira os campos do veículo.", detalhes: p.error.issues });
      return vehicles.upsert({ ...vehicles.get(id)!, ...(p.data as any), id });
    });
    r.delete("/api/veiculos/:id", async (req) => {
      vehicles.remove((req.params as any).id);
      return { ok: true };
    });
    r.post("/api/veiculos/importar", async (req, reply) => {
      const { csv } = (req.body ?? {}) as { csv?: string };
      if (!csv) return reply.code(400).send({ erro: "Envie o conteúdo do CSV." });
      const rows = parseCsv(csv);
      let criados = 0;
      const erros: string[] = [];
      for (const [i, r0] of rows.entries()) {
        const marca = r0.marca,
          modelo = r0.modelo;
        if (!marca || !modelo) {
          erros.push(`Linha ${i + 2}: faltou marca ou modelo`);
          continue;
        }
        const anoModelo = parseNumberBR(r0.ano_modelo || r0.ano);
        const v = {
          id: r0.id || newVehicleId({ marca, modelo, ano_modelo: anoModelo }),
          marca,
          modelo,
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
          fotos: (r0.fotos || "").split(/[|\s]+/).map((u) => u.trim()).filter((u) => /^https?:\/\/|^\//.test(u)).map((url) => ({ url })),
          status: (["disponivel", "reservado", "vendido"].includes(r0.status) ? r0.status : "disponivel") as Vehicle["status"],
          entrada_sugerida: parseNumberBR(r0.entrada_sugerida || r0.entrada),
        };
        vehicles.upsert(v as any);
        criados++;
      }
      return { importados: criados, erros };
    });

    // ───────── fotos ─────────
    r.post("/api/uploads", async (req, reply) => {
      const file = await (req as any).file();
      if (!file) return reply.code(400).send({ erro: "Nenhum arquivo enviado." });
      const ext = (path.extname(file.filename || "").toLowerCase() || ".jpg").replace(/[^.a-z0-9]/g, "");
      if (![".jpg", ".jpeg", ".png", ".webp", ".mp4"].includes(ext)) return reply.code(400).send({ erro: "Use foto JPG, PNG ou WEBP (ou vídeo MP4)." });
      const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      await fs.promises.writeFile(path.join(config.dataDir, "uploads", name), await file.toBuffer());
      return { url: `/uploads/${name}` };
    });

    // ───────── agenda ─────────
    r.get("/api/agenda", async (req) => {
      const q = req.query as { de?: string; ate?: string };
      const de = q.de ? new Date(q.de).toISOString() : new Date(Date.now() - 86400_000).toISOString();
      const ate = q.ate ? new Date(q.ate).toISOString() : new Date(Date.now() + 15 * 86400_000).toISOString();
      return appointments.between(de, ate);
    });
    r.get("/api/agenda/horarios", async () => availableSlots(getSettings(), { limite: 30 }));
    r.patch("/api/agenda/:id", async (req, reply) => {
      const id = Number((req.params as any).id);
      const b = (req.body ?? {}) as Record<string, any>;
      const a = appointments.update(id, {
        ...(b.status ? { status: b.status } : {}),
        ...(b.inicio ? { inicio: new Date(b.inicio).toISOString(), reminder_sent: false } : {}),
        ...(b.notas !== undefined ? { notas: b.notas } : {}),
      });
      if (!a) return reply.code(404).send({ erro: "Agendamento não encontrado." });
      if (b.status === "realizada") events.add(a.contact_id, "visita_realizada", { id });
      if (b.status === "faltou") events.add(a.contact_id, "visita_faltou", { id });
      publish({ type: "appointment", contactId: a.contact_id, appointmentId: id });
      return a;
    });

    // ───────── vendedores ─────────
    r.get("/api/vendedores", async () => sellers.all());
    r.post("/api/vendedores", async (req, reply) => {
      const b = z.object({ nome: z.string().min(1), whatsapp: z.string().min(10) }).safeParse(req.body);
      if (!b.success) return reply.code(400).send({ erro: "Informe nome e WhatsApp com DDD (ex.: 5521999998888)." });
      return sellers.create(b.data.nome, b.data.whatsapp.replace(/\D/g, ""));
    });
    r.put("/api/vendedores/:id", async (req) => sellers.update(Number((req.params as any).id), req.body as any));
    r.delete("/api/vendedores/:id", async (req) => {
      sellers.remove(Number((req.params as any).id));
      return { ok: true };
    });

    // ───────── configurações ─────────
    r.get("/api/config", async () => getSettings());
    r.put("/api/config", async (req) => saveSettings(req.body));

    r.get("/api/eventos", async () => events.recent(150));

    // ───────── simulador ─────────
    r.post("/api/simulador/mensagem", async (req, reply) => {
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
      const waId = `sim${d.telefone.replace(/\D/g, "")}`;
      const id = `simin-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      const row = await receive({
        channel: "simulador",
        waId,
        profileName: d.nome,
        waMessageId: id,
        timestamp: new Date(),
        type: d.botao ? "interactive" : d.imagem_base64 ? "image" : "text",
        text: d.texto ?? null,
        caption: d.imagem_base64 ? d.texto ?? null : null,
        interactive: d.botao ?? null,
        mediaData: d.imagem_base64 ? { data: Buffer.from(d.imagem_base64, "base64"), mime: d.mime ?? "image/jpeg" } : null,
        referral: d.anuncio ? { headline: d.anuncio.headline, body: d.anuncio.body, ctwa_clid: d.anuncio.ctwa_clid ?? `sim-clid-${Date.now()}`, source_type: "ad", source_id: "sim-ad" } : null,
      });
      const contact = contacts.byWaId(waId)!;
      if (d.aguardar) await flush(contact.id);
      return { contato_id: contact.id, mensagem: row };
    });
    r.post("/api/simulador/limpar", async (req) => {
      const telefone = String((req.body as any)?.telefone ?? "5521900000000");
      const c = contacts.byWaId(`sim${telefone.replace(/\D/g, "")}`);
      if (c) contacts.remove(c.id);
      return { ok: true };
    });

    r.delete("/api/conversas/:id/historico-ia", async (req) => {
      // começa uma conversa nova com a IA (mantém as mensagens no painel)
      aiTurns.endSessions(Number((req.params as any).id));
      return { ok: true, em: nowIso() };
    });
  });
}
