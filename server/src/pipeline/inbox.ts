import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { storeDir } from "../util/storage.js";
import { matchCampaign } from "../marketing/repo.js";
import { nowIso } from "../db/index.js";
import { contacts, events, messages, stores } from "../db/repos.js";
import type { Channel, MessageRow } from "../types.js";
import { publish } from "../util/bus.js";
import { log } from "../util/log.js";
import { wa } from "../whatsapp/client.js";
import { transcribe } from "../services/transcription.js";
import { ModelUnavailableError, runAgentTurn } from "../agent/runner.js";
import { deliver } from "./outbox.js";

export interface Referral {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  ctwa_clid?: string;
}

export interface Inbound {
  storeId: number;
  channel: Channel;
  waId: string;
  profileName: string | null;
  waMessageId: string;
  timestamp: Date;
  type: string; // text | image | audio | video | document | location | interactive | button | sticker | reaction | unsupported
  text?: string | null;
  caption?: string | null;
  mediaId?: string | null;
  mime?: string | null;
  filename?: string | null;
  /** imagem/áudio já disponível (simulador) */
  mediaData?: { data: Buffer; mime: string } | null;
  interactive?: { id: string; title: string } | null;
  location?: { latitude: number; longitude: number; name?: string; address?: string } | null;
  reaction?: { emoji: string; message_id: string } | null;
  referral?: Referral | null;
  contextId?: string | null;
}

const extFor = (mime: string) =>
  mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : mime.includes("mp4") ? "mp4" : "bin";

function saveMedia(storeId: number, key: string, data: Buffer, mime: string) {
  const file = `${storeDir("media", storeId)}/${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.${extFor(mime)}`;
  fs.writeFileSync(path.join(config.dataDir, "media", file), data);
  return { file, mime, url: `/media/${file}` };
}

function describe(inb: Inbound): string | null {
  switch (inb.type) {
    case "text":
      return inb.text ?? "";
    case "interactive":
    case "button":
      return inb.interactive?.title ?? inb.text ?? "";
    case "location":
      return `📍 ${inb.location?.name ?? "Localização"}${inb.location?.address ? ` — ${inb.location.address}` : ""}`;
    case "reaction":
      return inb.reaction?.emoji ?? "";
    default:
      return inb.caption ?? inb.text ?? null;
  }
}

/** Recebe uma mensagem do cliente (WhatsApp ou simulador), salva e agenda a resposta. */
export async function receive(inb: Inbound): Promise<MessageRow | null> {
  if (messages.byWaId(inb.waMessageId)) return null; // reentrega do webhook
  let contact = contacts.ensure(inb.storeId, inb.waId, inb.profileName, inb.channel);
  const creds = inb.channel === "whatsapp" ? stores.creds(inb.storeId) : null;

  if (inb.referral && (inb.referral.ctwa_clid || inb.referral.source_id)) {
    contacts.update(contact.id, {
      ctwa_clid: inb.referral.ctwa_clid ?? contact.ctwa_clid,
      ad_id: inb.referral.source_id ?? contact.ad_id,
      ad_headline: inb.referral.headline ?? contact.ad_headline,
      ad_source_url: inb.referral.source_url ?? contact.ad_source_url,
      origem: "anuncio",
    });
    // liga o lead à campanha de tráfego que o trouxe (resultado e contexto para a IA)
    const campaignId = matchCampaign(contact.store_id, inb.referral);
    if (campaignId) contacts.update(contact.id, { campaign_id: campaignId });
    events.add(contact.store_id, contact.id, "entrada_anuncio", { ...inb.referral, campaign_id: campaignId });
  } else if (!contact.origem) {
    contacts.update(contact.id, { origem: "organico" });
  }
  if (!contact.last_inbound_at) events.add(contact.store_id, contact.id, "nova_conversa", { origem: inb.referral ? "anuncio" : "organico" });

  // mídia
  let media: Record<string, unknown> | null = null;
  const meta: Record<string, unknown> = {};
  if (["image", "audio", "video", "document", "sticker"].includes(inb.type)) {
    try {
      let file = inb.mediaData ?? null;
      if (!file && inb.mediaId && creds) file = await wa.downloadMedia(creds, inb.mediaId);
      if (file) {
        media = saveMedia(inb.storeId, inb.waMessageId, file.data, file.mime);
        if (inb.type === "audio") {
          const t = await transcribe(file.data, file.mime);
          if (t) meta.transcricao = t;
        }
      }
    } catch (e) {
      log.warn("falha ao baixar mídia", { err: (e as Error).message, type: inb.type });
    }
    if (inb.filename) meta.filename = inb.filename;
  }
  if (inb.interactive) meta.interactive = inb.interactive;
  if (inb.location) meta.location = inb.location;
  if (inb.referral) meta.referral = inb.referral;
  if (inb.contextId) meta.reply_to = inb.contextId;

  const row = messages.add({
    contact_id: contact.id,
    direction: "in",
    sender: "cliente",
    type: inb.type,
    body: describe(inb),
    media,
    wa_message_id: inb.waMessageId,
    status: "received",
    meta: Object.keys(meta).length ? meta : null,
    created_at: inb.timestamp.toISOString(),
  });
  if (!row) return null;

  contacts.update(contact.id, { last_inbound_at: nowIso() });
  contact = contacts.get(contact.id)!;
  publish({ type: "message", contactId: contact.id, messageId: row.id });
  publish({ type: "contact", contactId: contact.id });

  if (inb.type === "reaction") return row; // reação sozinha não precisa de resposta
  if (contacts.isBotPaused(contact)) return row; // um humano está atendendo

  if (creds) void wa.readAndTyping(creds, inb.waMessageId);
  publish({ type: "typing", contactId: contact.id, on: true });
  schedule(contact.id);
  return row;
}

// ───────────────────────── fila por contato ─────────────────────────

const timers = new Map<number, NodeJS.Timeout>();
const running = new Map<number, Promise<void>>();
const rerun = new Set<number>();
const failures = new Map<number, number>();

export function schedule(contactId: number, delay = config.pipeline.debounceMs) {
  clearTimeout(timers.get(contactId));
  timers.set(
    contactId,
    setTimeout(() => {
      timers.delete(contactId);
      void kick(contactId);
    }, delay),
  );
}

async function kick(contactId: number) {
  if (running.has(contactId)) {
    rerun.add(contactId);
    return;
  }
  const p = processContact(contactId)
    .catch((e) => log.error("erro ao processar contato", { contactId, err: e }))
    .finally(() => {
      running.delete(contactId);
      publish({ type: "typing", contactId, on: false });
      if (rerun.delete(contactId)) schedule(contactId, 800);
    });
  running.set(contactId, p);
  await p;
}

/** Espera o processamento em andamento (útil em testes e no simulador). */
export async function flush(contactId: number) {
  const t = timers.get(contactId);
  if (t) {
    clearTimeout(t);
    timers.delete(contactId);
    await kick(contactId);
  }
  while (running.has(contactId)) await running.get(contactId);
}

export const isBusy = (contactId: number) => timers.has(contactId) || running.has(contactId);

const IMG_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

/** Monta o conteúdo do turno a partir das mensagens novas desde a última resposta da IA. */
export function buildUserBlocks(pending: MessageRow[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  let lines: string[] = [];
  let images = 0;
  const flushText = () => {
    if (lines.length) blocks.push({ type: "text", text: lines.join("\n") });
    lines = [];
  };

  for (const m of pending) {
    const meta = (m.meta ?? {}) as Record<string, any>;
    if (m.direction === "out" && m.sender === "vendedor") {
      lines.push(`[mensagem que um vendedor da loja enviou ao cliente: "${m.body ?? ""}"]`);
      continue;
    }
    if (m.direction !== "in") continue;
    if (meta.referral) {
      const r = meta.referral as Referral;
      lines.push(`[o cliente chegou por um anúncio${r.headline ? `: "${r.headline}"` : ""}${r.body ? ` — "${String(r.body).slice(0, 300)}"` : ""}]`);
    }
    switch (m.type) {
      case "text":
        lines.push(m.body ?? "");
        break;
      case "interactive":
      case "button":
        lines.push(`[o cliente tocou na opção "${meta.interactive?.title ?? m.body}" (id: ${meta.interactive?.id ?? "-"})]`);
        break;
      case "image": {
        const media = m.media as { file?: string; mime?: string } | null;
        if (media?.file && images < 4 && IMG_TYPES.includes(media.mime as any)) {
          flushText();
          const data = fs.readFileSync(path.join(config.dataDir, "media", media.file)).toString("base64");
          blocks.push({ type: "image", source: { type: "base64", media_type: media.mime as (typeof IMG_TYPES)[number], data } });
          images++;
          lines.push(m.body ? `[foto enviada pelo cliente, legenda: "${m.body}"]` : "[foto enviada pelo cliente]");
        } else lines.push("[o cliente mandou uma foto]");
        break;
      }
      case "audio":
        lines.push(
          meta.transcricao
            ? `[áudio do cliente, transcrito]: ${meta.transcricao}`
            : "[o cliente mandou um áudio que não consegui ouvir — peça com simpatia para ele escrever, porque aqui você só consegue ler]",
        );
        break;
      case "video":
        lines.push(`[o cliente mandou um vídeo${m.body ? `: "${m.body}"` : ""}]`);
        break;
      case "document":
        lines.push(`[o cliente mandou um documento${meta.filename ? ` (${meta.filename})` : ""}]`);
        break;
      case "location":
        lines.push(`[localização do cliente: ${meta.location?.name ?? ""} ${meta.location?.address ?? ""} (${meta.location?.latitude}, ${meta.location?.longitude})]`);
        break;
      case "sticker":
        lines.push("[figurinha]");
        break;
      case "reaction":
        lines.push(`[o cliente reagiu com ${m.body} a uma mensagem]`);
        break;
      default:
        lines.push(`[mensagem do tipo ${m.type} que não dá para ler aqui]`);
    }
  }
  flushText();
  if (!blocks.length) blocks.push({ type: "text", text: "[mensagem vazia]" });
  return blocks;
}

async function processContact(contactId: number) {
  const contact = contacts.get(contactId);
  if (!contact || contacts.isBotPaused(contact)) return;
  const pending = messages
    .forContact(contactId, 60, contact.ai_cursor)
    .filter((m) => m.direction === "in" || (m.direction === "out" && m.sender === "vendedor"));
  if (!pending.some((m) => m.direction === "in" && m.type !== "reaction")) return;

  const newCursor = Math.max(...pending.map((m) => m.id));
  const blocks = buildUserBlocks(pending);

  try {
    await runAgentTurn(contactId, blocks, { onCommit: () => contacts.update(contactId, { ai_cursor: newCursor }) });
    failures.delete(contactId);
  } catch (e) {
    const n = (failures.get(contactId) ?? 0) + 1;
    failures.set(contactId, n);
    log.error("falha no turno da IA", { contactId, tentativa: n, err: e });
    if (e instanceof ModelUnavailableError && n < 4) {
      schedule(contactId, 15_000 * n);
      return;
    }
    failures.delete(contactId);
    contacts.update(contactId, { ai_cursor: newCursor });
    events.add(contact.store_id, contactId, "ia_falhou", { erro: (e as Error).message });
    const c = contacts.get(contactId)!;
    await deliver(c, { type: "text", body: "Oi! Recebi sua mensagem 🙂 Um consultor da loja já vai te responder por aqui." }, "sistema");
    const { handoff } = await import("../services/handoff.js");
    await handoff(c, "duvida_sem_resposta", `A IA ficou indisponível (${(e as Error).message}). Responda o cliente manualmente.`, true);
  }
}
