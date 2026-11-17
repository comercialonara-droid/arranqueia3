import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { contacts, messages } from "../db/repos.js";
import { getSettings } from "../db/settings.js";
import { publish } from "../util/bus.js";
import { log } from "../util/log.js";
import { receive, type Inbound } from "../pipeline/inbox.js";

/** Confere a assinatura X-Hub-Signature-256 (HMAC-SHA256 do corpo com o App Secret). */
export function validSignature(raw: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!secret) return true; // sem App Secret configurado (apenas em desenvolvimento)
  if (!raw || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Converte uma mensagem do webhook da Cloud API no formato interno. */
export function parseMessage(m: any, profileName: string | null): Inbound {
  const base: Inbound = {
    channel: "whatsapp",
    waId: String(m.from),
    profileName,
    waMessageId: String(m.id),
    timestamp: new Date(Number(m.timestamp) * 1000 || Date.now()),
    type: m.type,
    referral: m.referral ?? null,
    contextId: m.context?.id ?? null,
  };
  switch (m.type) {
    case "text":
      return { ...base, text: m.text?.body ?? "" };
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker": {
      const media = m[m.type] ?? {};
      return { ...base, mediaId: media.id, mime: media.mime_type, caption: media.caption ?? null, filename: media.filename ?? null };
    }
    case "location":
      return { ...base, location: m.location };
    case "interactive": {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
      if (r) return { ...base, interactive: { id: r.id, title: r.title } };
      return { ...base, type: "text", text: m.interactive?.nfm_reply?.body ?? "[resposta de formulário]" };
    }
    case "button":
      return { ...base, interactive: { id: m.button?.payload ?? m.button?.text, title: m.button?.text ?? "" } };
    case "reaction":
      return { ...base, reaction: m.reaction, text: m.reaction?.emoji ?? "" };
    case "contacts":
      return { ...base, type: "text", text: `[cartão de contato: ${m.contacts?.[0]?.name?.formatted_name ?? ""} ${m.contacts?.[0]?.phones?.[0]?.phone ?? ""}]` };
    default:
      return { ...base, type: "unsupported", text: null };
  }
}

export function registerWebhook(app: FastifyInstance) {
  // Verificação do webhook pela Meta
  app.get("/webhook", async (req: FastifyRequest<{ Querystring: Record<string, string> }>, reply) => {
    const q = req.query;
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === config.whatsapp.verifyToken) return reply.type("text/plain").send(q["hub.challenge"]);
    return reply.code(403).send("token de verificação inválido");
  });

  app.post("/webhook", async (req, reply) => {
    const raw = (req as any).rawBody as Buffer | undefined;
    if (!validSignature(raw, req.headers["x-hub-signature-256"] as string | undefined, config.whatsapp.appSecret)) {
      log.warn("assinatura do webhook inválida");
      return reply.code(401).send();
    }
    // responde já: a Meta reenvia se demorar
    reply.code(200).send("ok");
    try {
      handlePayload(req.body as any);
    } catch (e) {
      log.error("erro ao tratar webhook", { err: e });
    }
  });
}

export function handlePayload(body: any) {
  if (body?.object !== "whatsapp_business_account") return;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (v.metadata?.phone_number_id && config.whatsapp.phoneNumberId && v.metadata.phone_number_id !== config.whatsapp.phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const c of v.contacts ?? []) if (c.wa_id) names.set(String(c.wa_id), c.profile?.name ?? null);

      for (const m of v.messages ?? []) {
        if (m.type === "system") continue;
        void receive(parseMessage(m, names.get(String(m.from)) ?? null)).catch((e) => log.error("falha ao receber mensagem", { err: e }));
      }

      for (const st of v.statuses ?? []) {
        messages.setStatus(String(st.id), st.status);
        if (st.status === "failed") log.warn("mensagem falhou na entrega", { id: st.id, errors: st.errors });
        const row = messages.byWaId(String(st.id));
        if (row) publish({ type: "message", contactId: row.contact_id, messageId: row.id });
      }

      // Coexistência: mensagens que a equipe mandou pelo app WhatsApp Business no celular
      for (const echo of v.message_echoes ?? []) {
        const to = String(echo.to ?? "");
        const c = contacts.byWaId(to);
        if (!c || messages.byWaId(String(echo.id))) continue;
        const row = messages.add({
          contact_id: c.id,
          direction: "out",
          sender: "vendedor",
          type: echo.type ?? "text",
          body: echo.text?.body ?? echo[echo.type]?.caption ?? `[${echo.type}]`,
          wa_message_id: String(echo.id),
          status: "sent",
          meta: { via: "app_whatsapp_business" },
        });
        // humano respondeu pelo celular → a IA sai de cena nesse contato
        const until = new Date(Date.now() + getSettings().handoff.pausar_ia_horas * 3600_000).toISOString();
        contacts.update(c.id, { bot_paused_until: until, paused_reason: "vendedor_respondeu_pelo_app" });
        if (row) publish({ type: "message", contactId: c.id, messageId: row.id });
        publish({ type: "contact", contactId: c.id });
      }
    }
  }
}
