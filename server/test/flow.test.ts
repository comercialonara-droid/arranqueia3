import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { vehicles, contacts, messages, leads, appointments, sellers, events } from "../src/db/repos.ts";
import { saveSettings } from "../src/db/settings.ts";
import { receive, flush, buildUserBlocks } from "../src/pipeline/inbox.ts";
import { checkSlot, availableSlots } from "../src/services/schedule.ts";
import { searchInventory } from "../src/services/inventory.ts";
import { getSettings } from "../src/db/settings.ts";
import { handlePayload } from "../src/whatsapp/webhook.ts";

// loja aberta todos os dias, para o teste não depender do dia em que roda
saveSettings({ horarios: Array(7).fill({ abre: "00:00", fecha: "23:59" }), agenda: { antecedencia_min_horas: 0 } });
vehicles.upsert({ id: "corolla", marca: "Toyota", modelo: "Corolla", versao: "XEi 2.0", ano_modelo: 2022, km: 117000, preco: 115900, cambio: "automatico", carroceria: "sedan", fotos: [{ url: "/uploads/a.jpg" }, { url: "/uploads/b.jpg" }], opcionais: [], destaques: [] } as any);
vehicles.upsert({ id: "s10", marca: "Chevrolet", modelo: "S10", versao: "LT", ano_modelo: 2014, km: 135000, preco: 89000, cambio: "manual", carroceria: "picape", fotos: [], opcionais: [], destaques: [] } as any);
sellers.create("Beto", "5521900000001");

let n = 0;
const say = async (texto: string, extra: Record<string, unknown> = {}) => {
  await receive({ channel: "simulador", waId: "sim1", profileName: "Ana", waMessageId: `t${n++}`, timestamp: new Date(), type: "text", text: texto, ...extra } as any);
  const c = contacts.byWaId("sim1")!;
  await flush(c.id);
  return c;
};

test("busca no estoque entende sinônimos e filtros", () => {
  const s = getSettings();
  assert.equal(searchInventory(s, { consulta: "picape" }).veiculos[0].id, "s10");
  assert.equal(searchInventory(s, { cambio: "automatico" }).total, 1);
  assert.equal(searchInventory(s, { preco_max: 90000 }).veiculos[0].id, "s10");
});

test("conversa completa: anúncio → estoque → fotos → visita → vendedor", async () => {
  const c = await say("tem corolla automático?", { referral: { headline: "Corolla 2022", ctwa_clid: "clid-1" } });
  const after1 = messages.forContact(c.id);
  assert.ok(after1.some((m) => m.direction === "out" && m.type === "image"), "mandou fotos");
  assert.equal(contacts.get(c.id)!.ctwa_clid, "clid-1");
  assert.ok(leads.get(c.id)!.interesse.includes("corolla"));

  await say("quero agendar uma visita");
  const btns = messages.forContact(c.id).filter((m) => m.type === "buttons");
  assert.ok(btns.length >= 1, "ofereceu horários em botões");
  const slot = (btns.at(-1)!.media as any).buttons[0];
  await receive({ channel: "simulador", waId: "sim1", profileName: "Ana", waMessageId: `t${n++}`, timestamp: new Date(), type: "interactive", interactive: { id: slot.id, title: slot.title } } as any);
  await flush(c.id);
  assert.equal(appointments.upcomingForContact(c.id).length, 1, "agendou");
  assert.equal(leads.get(c.id)!.stage, "visita_agendada");
  assert.ok(events.has(c.id, "capi:qualificado"));

  await say("tem desconto? quero falar com um vendedor");
  const cc = contacts.get(c.id)!;
  assert.ok(contacts.isBotPaused(cc), "IA pausou");
  assert.equal(sellers.get(cc.seller_id!)!.nome, "Beto");

  const before = messages.forContact(c.id).length;
  await say("alô?");
  const after = messages.forContact(c.id);
  assert.equal(after.length, before + 1, "com humano atendendo, a IA não responde");
});

test("mensagem duplicada do webhook é ignorada", async () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { contacts: [{ wa_id: "5521988880000", profile: { name: "Zé" } }], messages: [{ from: "5521988880000", id: "wamid.dup", timestamp: "1763390000", type: "text", text: { body: "oi" } }] } }] }],
  };
  handlePayload(payload);
  handlePayload(payload);
  await new Promise((r) => setTimeout(r, 50));
  const c = contacts.byWaId("5521988880000")!;
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

test("agenda respeita expediente e lotação", () => {
  saveSettings({ horarios: [null, { abre: "09:00", fecha: "18:00" }, { abre: "09:00", fecha: "18:00" }, { abre: "09:00", fecha: "18:00" }, { abre: "09:00", fecha: "18:00" }, { abre: "09:00", fecha: "18:00" }, null] });
  const s = getSettings();
  const sunday = "2027-01-03"; // domingo
  const r = checkSlot(s, sunday, "10:00");
  assert.equal(r.ok, false);
  for (const slot of availableSlots(s, { limite: 20 })) {
    const h = Number(slot.hora.slice(0, 2));
    assert.ok(h >= 9 && h < 18);
  }
});
