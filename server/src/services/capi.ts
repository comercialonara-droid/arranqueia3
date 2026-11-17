import { config } from "../config.js";
import { contacts, events } from "../db/repos.js";
import { getSettings } from "../db/settings.js";
import { log } from "../util/log.js";

export type ConversionKind = "lead" | "qualificado" | "venda";

/**
 * Conversions API para mensagens (Click-to-WhatsApp).
 * Devolve para a Meta os eventos que acontecem na conversa, com o ctwa_clid do anúncio,
 * para a campanha otimizar por quem realmente vira lead/visita/venda — não só por "conversa iniciada".
 * A Meta não deduplica esses eventos, então a deduplicação é feita aqui (um evento de cada tipo por contato;
 * vendas podem repetir com valores diferentes).
 */
export async function sendConversion(contactId: number, kind: ConversionKind, opts: { value?: number; currency?: string } = {}) {
  const s = getSettings();
  const contact = contacts.get(contactId);
  if (!contact) return { status: "sem_contato" };

  const eventName = kind === "lead" ? s.conversoes.evento_lead : kind === "qualificado" ? s.conversoes.evento_qualificado : s.conversoes.evento_venda;
  const internalName = `capi:${kind}`;
  if (kind !== "venda" && events.has(contactId, internalName)) return { status: "duplicado" };

  const evId = events.add(contactId, internalName, { event_name: eventName, value: opts.value ?? null });

  if (!s.conversoes.ativo) {
    events.setCapi(evId, "desativado", null);
    return { status: "desativado" };
  }
  if (!contact.ctwa_clid) {
    events.setCapi(evId, "organico", null);
    return { status: "organico" };
  }
  if (!config.meta.datasetId || !config.meta.capiToken || !config.whatsapp.wabaId) {
    events.setCapi(evId, "nao_configurado", null);
    return { status: "nao_configurado" };
  }

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: {
          whatsapp_business_account_id: config.whatsapp.wabaId,
          ctwa_clid: contact.ctwa_clid,
        },
        ...(opts.value != null ? { custom_data: { currency: opts.currency ?? "BRL", value: opts.value } } : {}),
      },
    ],
    ...(config.meta.testEventCode ? { test_event_code: config.meta.testEventCode } : {}),
  };

  try {
    const res = await fetch(`https://graph.facebook.com/${config.whatsapp.graphVersion}/${config.meta.datasetId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.meta.capiToken}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    const status = res.ok ? "enviado" : "erro";
    events.setCapi(evId, status, json);
    if (!res.ok) log.warn("CAPI recusou evento", { contactId, eventName, json });
    return { status, response: json };
  } catch (e) {
    events.setCapi(evId, "erro", { message: (e as Error).message });
    return { status: "erro" };
  }
}
