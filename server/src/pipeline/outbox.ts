import { config } from "../config.js";
import { contacts, messages, stores } from "../db/repos.js";
import type { Contact, MessageRow, Sender } from "../types.js";
import { publish } from "../util/bus.js";
import { log } from "../util/log.js";
import { GraphError, wa, type ButtonOpt, type ListRow } from "../whatsapp/client.js";
import { nowIso } from "../db/index.js";

export type OutItem =
  | { type: "text"; body: string }
  | { type: "image"; url: string; caption?: string }
  | { type: "video"; url: string; caption?: string }
  | { type: "audio"; url: string; titulo?: string }
  | { type: "buttons"; body: string; buttons: ButtonOpt[]; footer?: string }
  | { type: "list"; body: string; buttonText: string; rows: ListRow[] }
  | { type: "location"; lat: number; lng: number; name: string; address: string }
  | { type: "contact"; nome: string; telefone: string; empresa?: string }
  | { type: "template"; name: string; language: string; params?: string[]; preview: string };

export const absoluteUrl = (u: string) => (/^https?:\/\//.test(u) ? u : `${config.publicUrl}${u.startsWith("/") ? "" : "/"}${u}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bodyOf(item: OutItem): string | null {
  switch (item.type) {
    case "text":
      return item.body;
    case "image":
    case "video":
      return item.caption ?? null;
    case "buttons":
    case "list":
      return item.body;
    case "audio":
      return item.titulo ? `🎤 ${item.titulo}` : "🎤 Áudio";
    case "location":
      return `📍 ${item.name} — ${item.address}`;
    case "contact":
      return `Contato: ${item.nome} (+${item.telefone})`;
    case "template":
      return item.preview;
  }
}

function mediaOf(item: OutItem): unknown {
  switch (item.type) {
    case "image":
    case "video":
    case "audio":
      return { url: item.url };
    case "buttons":
      return { buttons: item.buttons };
    case "list":
      return { buttonText: item.buttonText, rows: item.rows };
    case "location":
      return { lat: item.lat, lng: item.lng, name: item.name, address: item.address };
    case "contact":
      return { nome: item.nome, telefone: item.telefone };
    case "template":
      return { template: item.name, language: item.language, params: item.params ?? [] };
    default:
      return null;
  }
}

/** Diz se ainda estamos dentro da janela de atendimento de 24h do WhatsApp. */
export function insideServiceWindow(c: Contact): boolean {
  if (!c.last_inbound_at) return false;
  return Date.now() - new Date(c.last_inbound_at).getTime() < 24 * 3600_000 - 5 * 60_000;
}

/**
 * Envia um item ao cliente (WhatsApp real ou simulador), registra no histórico e avisa o painel.
 * Retorna a linha salva — com status "failed" se a Meta recusou.
 */
export async function deliver(contact: Contact, item: OutItem, sender: Sender = "ia", meta?: Record<string, unknown>): Promise<MessageRow> {
  const row = messages.add({
    contact_id: contact.id,
    direction: "out",
    sender,
    type: item.type,
    body: bodyOf(item),
    media: mediaOf(item),
    status: "queued",
    meta: meta ?? null,
  })!;
  publish({ type: "message", contactId: contact.id, messageId: row.id });

  const creds = contact.channel === "simulador" ? null : stores.creds(contact.store_id);
  if (!creds) {
    messages.setWaId(row.id, `sim-${row.id}`, contact.channel === "simulador" ? "simulado" : "sem_whatsapp");
  } else {
    try {
      const to = contact.wa_id;
      const c = creds;
      let id = "";
      switch (item.type) {
        case "text":
          id = await wa.text(c, to, item.body);
          break;
        case "image":
          id = await wa.image(c, to, absoluteUrl(item.url), item.caption);
          break;
        case "video":
          id = await wa.video(c, to, absoluteUrl(item.url), item.caption);
          break;
        case "audio":
          id = await wa.audio(c, to, absoluteUrl(item.url));
          break;
        case "buttons":
          id = await wa.buttons(c, to, item.body, item.buttons, item.footer);
          break;
        case "list":
          id = await wa.list(c, to, item.body, item.buttonText, item.rows);
          break;
        case "location":
          id = await wa.location(c, to, item.lat, item.lng, item.name, item.address);
          break;
        case "contact":
          id = await wa.contact(c, to, item.nome, item.telefone, item.empresa);
          break;
        case "template":
          id = await wa.template(c, to, item.name, item.language, item.params ?? []);
          break;
      }
      messages.setWaId(row.id, id || `out-${row.id}`, "sent");
    } catch (e) {
      const reason = e instanceof GraphError ? `${e.code ?? e.status}: ${e.message}` : (e as Error).message;
      log.warn("falha ao enviar mensagem", { contactId: contact.id, type: item.type, reason });
      messages.setFailed(row.id, reason);
      publish({ type: "message", contactId: contact.id, messageId: row.id });
      return messages.get(row.id)!;
    }
  }
  contacts.update(contact.id, { last_outbound_at: nowIso() });
  publish({ type: "message", contactId: contact.id, messageId: row.id });
  return messages.get(row.id)!;
}

/** Envia vários itens com um intervalo curto, como uma pessoa digitando. */
export async function deliverSequence(contact: Contact, items: OutItem[], sender: Sender = "ia") {
  const out: MessageRow[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && contact.channel !== "simulador") {
      const it = items[i];
      const len = it.type === "text" ? it.body.length : 40;
      await sleep(Math.min(config.pipeline.typingDelayMs + len * 15, 4000));
    }
    out.push(await deliver(contact, items[i], sender));
  }
  return out;
}

/**
 * Quebra a resposta do modelo em balões de WhatsApp: cada parágrafo vira uma mensagem
 * (no máximo 4), sem cortar no meio de frases.
 */
export function splitIntoBubbles(text: string, maxBubbles = 4): string[] {
  const parts = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= maxBubbles) return parts;
  const head = parts.slice(0, maxBubbles - 1);
  head.push(parts.slice(maxBubbles - 1).join("\n\n"));
  return head;
}
