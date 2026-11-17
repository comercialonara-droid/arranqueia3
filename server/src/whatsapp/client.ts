import { config } from "../config.js";
import type { WaCreds } from "../types.js";
import { log } from "../util/log.js";

/** Erro da Graph API com o código da Meta (ex.: 131047 = fora da janela de 24h). */
export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
    public details?: unknown,
  ) {
    super(message);
  }
  get outsideWindow() {
    return this.code === 131047;
  }
}

const base = () => `https://graph.facebook.com/${config.whatsapp.graphVersion}`;

async function graph<T = any>(token: string, path: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(`${base()}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new GraphError(e.error_user_msg || e.message || `Graph ${res.status}`, res.status, e.code, e);
  }
  return json as T;
}

type SendResult = { messages?: { id: string }[] };

async function send(c: WaCreds, payload: Record<string, unknown>): Promise<string> {
  const r = await graph<SendResult>(c.accessToken, `${c.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...payload,
  });
  return r.messages?.[0]?.id ?? "";
}

export interface ButtonOpt {
  id: string;
  title: string; // até 20 caracteres
}
export interface ListRow {
  id: string;
  title: string; // até 24
  description?: string; // até 72
}

const cut = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

export const wa = {
  text: (c: WaCreds, to: string, body: string) => send(c, { to, type: "text", text: { body: cut(body, 4096), preview_url: /https?:\/\//.test(body) } }),

  image: (c: WaCreds, to: string, link: string, caption?: string) =>
    send(c, { to, type: "image", image: { link, ...(caption ? { caption: cut(caption, 1024) } : {}) } }),

  video: (c: WaCreds, to: string, link: string, caption?: string) =>
    send(c, { to, type: "video", video: { link, ...(caption ? { caption: cut(caption, 1024) } : {}) } }),

  buttons: (c: WaCreds, to: string, body: string, buttons: ButtonOpt[], footer?: string) =>
    send(c, {
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: cut(body, 1024) },
        ...(footer ? { footer: { text: cut(footer, 60) } } : {}),
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: cut(b.id, 256), title: cut(b.title, 20) } })) },
      },
    }),

  list: (c: WaCreds, to: string, body: string, buttonText: string, rows: ListRow[], sectionTitle = "Opções") =>
    send(c, {
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: cut(body, 4096) },
        action: {
          button: cut(buttonText, 20),
          sections: [
            {
              title: cut(sectionTitle, 24),
              rows: rows.slice(0, 10).map((r) => ({ id: cut(r.id, 200), title: cut(r.title, 24), ...(r.description ? { description: cut(r.description, 72) } : {}) })),
            },
          ],
        },
      },
    }),

  location: (c: WaCreds, to: string, lat: number, lng: number, name: string, address: string) =>
    send(c, { to, type: "location", location: { latitude: lat, longitude: lng, name, address } }),

  contact: (c: WaCreds, to: string, nome: string, telefone: string, empresa?: string) =>
    send(c, {
      to,
      type: "contacts",
      contacts: [
        {
          name: { formatted_name: nome, first_name: nome },
          phones: [{ phone: `+${telefone.replace(/\D/g, "")}`, wa_id: telefone.replace(/\D/g, ""), type: "WORK" }],
          ...(empresa ? { org: { company: empresa } } : {}),
        },
      ],
    }),

  audio: (c: WaCreds, to: string, link: string) => send(c, { to, type: "audio", audio: { link } }),

  template: (c: WaCreds, to: string, name: string, language: string, bodyParams: string[] = []) =>
    send(c, {
      to,
      type: "template",
      template: {
        name,
        language: { code: language },
        ...(bodyParams.length ? { components: [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }] } : {}),
      },
    }),

  /** Marca como lida e mostra "digitando…" ao cliente (some sozinho ao responder ou após ~25s). */
  async readAndTyping(c: WaCreds, messageId: string) {
    try {
      await graph(c.accessToken, `${c.phoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      });
    } catch (e) {
      log.debug("typing indicator falhou", { err: (e as Error).message });
    }
  },

  async reaction(c: WaCreds, to: string, messageId: string, emoji: string) {
    return send(c, { to, type: "reaction", reaction: { message_id: messageId, emoji } });
  },

  /** Baixa uma mídia recebida (áudio, imagem, documento). */
  async downloadMedia(c: WaCreds, mediaId: string): Promise<{ data: Buffer; mime: string }> {
    const meta = await graph<{ url: string; mime_type: string }>(c.accessToken, mediaId, undefined, "GET");
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${c.accessToken}` } });
    if (!res.ok) throw new GraphError(`Falha ao baixar mídia (${res.status})`, res.status);
    return { data: Buffer.from(await res.arrayBuffer()), mime: meta.mime_type };
  },

  graph,
};
