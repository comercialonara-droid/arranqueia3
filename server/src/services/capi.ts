import { config } from "../config.js";
import { contacts, events, stores } from "../db/repos.js";
import { getSettings } from "../db/settings.js";
import { log } from "../util/log.js";

export type ConversionKind = "lead" | "qualificado" | "venda";

/**
 * Conversions API para mensagens (Click-to-WhatsApp): devolve para a Meta os eventos da conversa
 * com o ctwa_clid do anúncio. A Meta não deduplica esses eventos, então a deduplicação é feita aqui.
 */
export async function sendConversion(contactId: number, kind: ConversionKind, opts: { value?: number; currency?: string } = {}) {
  const contact = contacts.get(contactId);
  if (!contact) return { status: "sem_contato" };
  const s = getSettings(contact.store_id);
  const eventName = kind === "lead" ? s.conversoes.evento_lead : kind === "qualificado" ? s.conversoes.evento_qualificado : s.conversoes.evento_venda;
  const internalName = `capi:${kind}`;
  if (kind !== "venda" && events.has(contactId, internalName)) return { status: "duplicado" };

  const evId = events.add(contact.store_id, contactId, internalName, { event_name: eventName, value: opts.value ?? null });
  if (!s.conversoes.ativo) return events.setCapi(evId, "desativado", null), { status: "desativado" };
  if (!contact.ctwa_clid) return events.setCapi(evId, "organico", null), { status: "organico" };

  const store = stores.get(contact.store_id);
  const creds = stores.creds(contact.store_id);
  const datasetId = store?.meta_dataset_id || config.meta.datasetId;
  const wabaId = creds?.wabaId || config.whatsapp.wabaId;
  const token = config.meta.capiToken && !store?.wa_access_token ? config.meta.capiToken : creds?.accessToken;
  if (!datasetId || !token || !wabaId) return events.setCapi(evId, "nao_configurado", null), { status: "nao_configurado" };

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: { whatsapp_business_account_id: wabaId, ctwa_clid: contact.ctwa_clid },
        ...(opts.value != null ? { custom_data: { currency: opts.currency ?? "BRL", value: opts.value } } : {}),
      },
    ],
    ...(config.meta.testEventCode ? { test_event_code: config.meta.testEventCode } : {}),
  };

  try {
    const res = await fetch(`https://graph.facebook.com/${config.whatsapp.graphVersion}/${datasetId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    events.setCapi(evId, res.ok ? "enviado" : "erro", json);
    if (!res.ok) log.warn("CAPI recusou evento", { contactId, eventName, json });
    return { status: res.ok ? "enviado" : "erro", response: json };
  } catch (e) {
    events.setCapi(evId, "erro", { message: (e as Error).message });
    return { status: "erro" };
  }
}
