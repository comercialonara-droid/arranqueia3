import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { vehicles, contacts, messages, leads, appointments, users, events, stores, simulations } from "../src/db/repos.ts";
import { saveSettings, getSettings } from "../src/db/settings.ts";
import { receive, flush, buildUserBlocks } from "../src/pipeline/inbox.ts";
import { checkSlot, availableSlots } from "../src/services/schedule.ts";
import { searchInventory } from "../src/services/inventory.ts";
import { handlePayload } from "../src/whatsapp/webhook.ts";
import { decrypt } from "../src/util/crypto.ts";

const fa = stores.create("FA Veículos", "fa");
const outra = stores.create("Outra Loja", "outra");
stores.update(fa.id, { wa_phone_number_id: "PNID-FA" });
stores.update(outra.id, { wa_phone_number_id: "PNID-OUTRA" });
saveSettings(fa.id, { horarios: Array(7).fill({ abre: "00:00", fecha: "23:59" }), agenda: { antecedencia_min_horas: 0 }, atendimento: { politica_preco: "so_vendedor" } });
vehicles.upsert({ id: "corolla", store_id: fa.id, marca: "Toyota", modelo: "Corolla", versao: "XEi 2.0", ano_modelo: 2022, km: 117000, preco: 115900, cambio: "automatico", carroceria: "sedan", fotos: [{ url: "/uploads/a.jpg" }, { url: "/uploads/b.jpg" }], videos: [], opcionais: [], destaques: [] } as any);
vehicles.upsert({ id: "s10", store_id: fa.id, marca: "Chevrolet", modelo: "S10", versao: "LT", ano_modelo: 2014, km: 135000, preco: 89000, cambio: "manual", carroceria: "picape", fotos: [], videos: [], opcionais: [], destaques: [] } as any);
vehicles.upsert({ id: "hb20-outra", store_id: outra.id, marca: "Hyundai", modelo: "HB20", ano_modelo: 2020, fotos: [], videos: [], opcionais: [], destaques: [] } as any);
const beto = users.create({ store_id: fa.id, role: "vendedor", nome: "Beto", email: "beto@fa", senha: "senha-forte-1", whatsapp: "5521900000001", recebe_leads: true });

let n = 0;
const say = async (texto: string, extra: Record<string, unknown> = {}) => {
  await receive({ storeId: fa.id, channel: "simulador", waId: "sim1", profileName: "Ana", waMessageId: `t${n++}`, timestamp: new Date(), type: "text", text: texto, ...extra } as any);
  const c = contacts.byWaId(fa.id, "sim1")!;
  await flush(c.id);
  return c;
};

test("estoque é separado por loja e entende sinônimos", () => {
  const s = getSettings(fa.id);
  assert.equal(searchInventory(s, fa.id, { consulta: "picape" }).veiculos[0].id, "s10");
  assert.equal(searchInventory(s, fa.id, { cambio: "automatico" }).total, 1);
  assert.equal(searchInventory(s, outra.id, {}).total, 1);
  const card = searchInventory(s, fa.id, { consulta: "corolla" }).veiculos[0] as any;
  assert.equal(card.preco, undefined, "loja sem valores: a IA não recebe o preço");
});

test("funil completo: anúncio → fotos → preço só com consultor → simulação → vendedor", async () => {
  const c = await say("oi vi o anúncio do corolla", { referral: { headline: "Corolla 2022", ctwa_clid: "clid-1" } });
  assert.ok(messages.forContact(c.id).some((m) => m.direction === "out" && m.type === "image"), "mandou fotos");
  assert.equal(contacts.get(c.id)!.ctwa_clid, "clid-1");

  await say("quanto ta?");
  const resp = messages.forContact(c.id).filter((m) => m.direction === "out").at(-1)!;
  assert.ok(!/R\$/.test(resp.body ?? ""), "não fala valores");

  await say("quero simular, tenho 20 mil de entrada");
  assert.equal(leads.get(c.id)!.intencao, "simulacao");
  await say("Ana Paula Souza");
  await say("meu cpf 529.982.247-25 nasci em 15/03/1990");
  await say("tenho sim");

  const sim = simulations.latest(c.id)!;
  assert.equal(sim.status, "enviada");
  assert.equal(decrypt(sim.cpf_enc), "52998224725");
  assert.equal(sim.data_nascimento, "1990-03-15");
  assert.equal(sim.tem_cnh, true);
  assert.equal(sim.seller_id, beto.id, "rodízio escolheu o Beto");
  const cc = contacts.get(c.id)!;
  assert.ok(contacts.isBotPaused(cc), "IA sai da conversa");
  assert.equal(leads.get(c.id)!.stage, "simulacao");
  assert.equal(leads.get(c.id)!.temperatura, "pronto");
  assert.ok(events.has(c.id, "capi:qualificado"));

  const before = messages.forContact(c.id).length;
  await say("alô?");
  assert.equal(messages.forContact(c.id).length, before + 1, "com humano, a IA não responde");
});

test("webhook entrega na loja certa e ignora repetição", async () => {
  const payload = (pnid: string, id: string) => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: pnid }, contacts: [{ wa_id: "5521988880000", profile: { name: "Zé" } }], messages: [{ from: "5521988880000", id, timestamp: "1763390000", type: "text", text: { body: "oi" } }] } }] }],
  });
  handlePayload(payload("PNID-OUTRA", "wamid.a"));
  handlePayload(payload("PNID-OUTRA", "wamid.a"));
  handlePayload(payload("PNID-DESCONHECIDO", "wamid.b"));
  await new Promise((r) => setTimeout(r, 60));
  const c = contacts.byWaId(outra.id, "5521988880000")!;
  assert.ok(c, "contato criado na outra loja");
  assert.equal(contacts.byWaId(fa.id, "5521988880000"), null, "não vaza para a FA");
  assert.equal(messages.forContact(c.id).filter((m) => m.direction === "in").length, 1);
});

test("conteúdo do turno inclui mensagem do vendedor e áudio sem transcrição", () => {
  const blocks = buildUserBlocks([
    { id: 1, contact_id: 1, direction: "out", sender: "vendedor", type: "text", body: "Te espero amanhã!", media: null, wa_message_id: null, status: null, created_at: "", meta: null },
    { id: 2, contact_id: 1, direction: "in", sender: "cliente", type: "audio", body: null, media: null, wa_message_id: null, status: null, created_at: "", meta: null },
  ]);
  const text = (blocks[0] as any).text as string;
  assert.match(text, /vendedor da loja/);
  assert.match(text, /áudio/);
});

test("agenda respeita expediente", () => {
  saveSettings(fa.id, { horarios: [null, { abre: "09:00", fecha: "18:00" }, { abre: "09:00", fecha: "18:00" }, { abre: "09:00", fecha: "18:00" }, { abre: "09:00", fecha: "18:00" }, { abre: "09:00", fecha: "18:00" }, null] });
  const s = getSettings(fa.id);
  assert.equal(checkSlot(fa.id, s, "2027-01-03", "10:00").ok, false); // domingo
  for (const slot of availableSlots(fa.id, s, { limite: 20 })) {
    const h = Number(slot.hora.slice(0, 2));
    assert.ok(h >= 9 && h < 18);
  }
  void appointments;
});
