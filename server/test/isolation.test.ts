import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { config } from "../src/config.ts";
import { audios, contacts, notes, quickReplies, simulations, stores, users, vehicles } from "../src/db/repos.ts";
import { getSettings, saveSettings } from "../src/db/settings.ts";
import { receive, flush } from "../src/pipeline/inbox.ts";
import { registerAdmin } from "../src/api/admin.ts";
import { registerMedia } from "../src/api/media.ts";
import { issueToken } from "../src/api/auth.ts";
import { storeDir } from "../src/util/storage.ts";
import { searchInventory } from "../src/services/inventory.ts";
import { toolDefinitions } from "../src/agent/tools.ts";
import { buildSystemPrompt } from "../src/agent/prompt.ts";
import { segmentDefaults } from "../src/segments.ts";

// Duas lojas de segmentos diferentes, cada uma com seus dados
const carros = stores.create("Loja de Carros", "carros-iso");
const bikes = stores.create("Loja de Bikes", "bikes-iso");
saveSettings(bikes.id, segmentDefaults("bikes_eletricas"));
saveSettings(bikes.id, { loja: { nome: "Loja de Bikes" } });

const donoA = users.create({ store_id: carros.id, role: "dono", nome: "Dono A", email: "dono@a", senha: "senha-forte-1" });
const vendA = users.create({ store_id: carros.id, role: "vendedor", nome: "Vend A", email: "vend@a", senha: "senha-forte-1" });
const donoB = users.create({ store_id: bikes.id, role: "dono", nome: "Dono B", email: "dono@b", senha: "senha-forte-1" });
const admin = users.create({ store_id: null, role: "admin", nome: "Admin", email: "admin@iso", senha: "senha-forte-1" });

vehicles.upsert({ id: "corolla-iso", store_id: carros.id, marca: "Toyota", modelo: "Corolla", ano_modelo: 2022, km: 100000, preco: 115900, cambio: "automatico", fotos: [], videos: [], opcionais: [], destaques: [] } as any);
vehicles.upsert({ id: "v9-iso", store_id: bikes.id, marca: "VOLTTA", modelo: "V9 Max", ano_modelo: 2026, preco: 7999, fotos: [], videos: [], opcionais: [], destaques: ["Cadeado integrado"], ficha: { motor_w: "1000", autonomia_km: "50" } } as any);
vehicles.upsert({ id: "v8max-iso", store_id: bikes.id, marca: "OUXI", modelo: "V8 Pro Max", ano_modelo: 2026, preco: 10599, fotos: [], videos: [], opcionais: [], destaques: [], ficha: { autonomia_km: "120", bateria: "duas baterias" } } as any);

const audioA = audios.create({ store_id: carros.id, titulo: "Boas-vindas do Beto", quando_usar: "início", url: "/uploads/loja-1/a.ogg", mime: "audio/ogg", duracao_s: 10 });
const audioB = audios.create({ store_id: bikes.id, titulo: "Boas-vindas da Voltta", quando_usar: "início", url: "/uploads/loja-2/b.ogg", mime: "audio/ogg", duracao_s: 10 });
const qrB = quickReplies.create(bikes.id, "/oi", "Oi! Tudo bem?") as { id: number };

let n = 0;
async function conversa(storeId: number, waId: string, texto: string) {
  await receive({ storeId, channel: "simulador", waId, profileName: "Cliente", waMessageId: `iso${n++}`, timestamp: new Date(), type: "text", text: texto } as any);
  const c = contacts.byWaId(storeId, waId)!;
  await flush(c.id);
  return contacts.get(c.id)!;
}

const app = Fastify();
await app.register(multipart);
registerAdmin(app);
registerMedia(app);
await app.ready();

const as = (u: { id: number }, loja?: number) => ({ cookie: `arranque_sessao=${encodeURIComponent(issueToken(u.id))}`, ...(loja ? { "x-loja": String(loja) } : {}) });
const get = (u: { id: number }, url: string, loja?: number) => app.inject({ method: "GET", url, headers: as(u, loja) });

test("a mesma pessoa falando com duas lojas vira duas conversas separadas", async () => {
  const a = await conversa(carros.id, "5521999990000", "oi, tem corolla?");
  const b = await conversa(bikes.id, "5521999990000", "oi, tem bike com duas baterias?");
  assert.notEqual(a.id, b.id);
  assert.equal(a.store_id, carros.id);
  assert.equal(b.store_id, bikes.id);
});

test("dono e vendedor só veem a própria loja, mesmo forçando o cabeçalho de outra", async () => {
  const listaA = (await get(donoA, "/api/conversas", bikes.id)).json() as any[];
  assert.ok(listaA.length > 0 && listaA.every((c) => c.store_id === carros.id));
  const listaB = (await get(donoB, "/api/conversas")).json() as any[];
  assert.ok(listaB.every((c) => c.store_id === bikes.id));

  const cB = contacts.byWaId(bikes.id, "5521999990000")!;
  for (const u of [donoA, vendA]) {
    assert.equal((await get(u, `/api/conversas/${cB.id}`, bikes.id)).statusCode, 404);
    const env = await app.inject({ method: "POST", url: `/api/conversas/${cB.id}/enviar`, headers: as(u, bikes.id), payload: { texto: "oi" } });
    assert.equal(env.statusCode, 404);
    const nota = await app.inject({ method: "POST", url: `/api/conversas/${cB.id}/notas`, headers: as(u, bikes.id), payload: { texto: "x" } });
    assert.notEqual(nota.statusCode, 200);
  }
});

test("biblioteca de áudios e respostas prontas é de cada loja", async () => {
  const aA = (await get(donoA, "/api/audios", bikes.id)).json() as any[];
  assert.deepEqual(aA.map((a) => a.id), [audioA.id]);
  const aB = (await get(donoB, "/api/audios")).json() as any[];
  assert.deepEqual(aB.map((a) => a.id), [audioB.id]);

  // não dá para usar, editar ou apagar o áudio de outra loja
  const cA = contacts.byWaId(carros.id, "5521999990000")!;
  const usar = await app.inject({ method: "POST", url: `/api/conversas/${cA.id}/audio/${audioB.id}`, headers: as(donoA) });
  assert.equal(usar.statusCode, 404);
  const editar = await app.inject({ method: "PUT", url: `/api/audios/${audioB.id}`, headers: as(donoA), payload: { titulo: "hackeado" } });
  assert.equal(editar.statusCode, 404);
  await app.inject({ method: "DELETE", url: `/api/audios/${audioB.id}`, headers: as(donoA) });
  assert.equal(audios.get(audioB.id)?.titulo, "Boas-vindas da Voltta");

  assert.equal(((await get(donoA, "/api/respostas-rapidas")).json() as any[]).length, 0);
  await app.inject({ method: "DELETE", url: `/api/respostas-rapidas/${qrB.id}`, headers: as(donoA) });
  assert.equal(quickReplies.forStore(bikes.id).length, 1);
});

test("estoque: uma loja não enxerga nem sobrescreve produto da outra", async () => {
  const vA = (await get(donoA, "/api/veiculos")).json() as any[];
  assert.deepEqual(vA.map((v) => v.id), ["corolla-iso"]);
  // tenta cadastrar com o código de um produto da loja de bikes
  const r = await app.inject({ method: "POST", url: "/api/veiculos", headers: as(donoA), payload: { id: "v9-iso", marca: "Fiat", modelo: "Uno", ano_modelo: 2010 } });
  assert.equal(r.statusCode, 200);
  assert.notEqual(r.json().id, "v9-iso");
  assert.equal(vehicles.get("v9-iso")!.store_id, bikes.id);
  assert.equal(vehicles.get("v9-iso")!.modelo, "V9 Max");
  assert.throws(() => vehicles.upsert({ id: "v9-iso", store_id: carros.id, marca: "X", modelo: "Y" } as any));
  assert.equal((await app.inject({ method: "DELETE", url: "/api/veiculos/v9-iso", headers: as(donoA) })).statusCode, 200);
  assert.ok(vehicles.get("v9-iso"), "não apagou o da outra loja");
});

test("notas, equipe, simulações e eventos não vazam", async () => {
  const cB = contacts.byWaId(bikes.id, "5521999990000")!;
  const cA = contacts.byWaId(carros.id, "5521999990000")!;
  const notaB = notes.add(cB.id, donoB.id, "Dono B", "cliente quer a V9");
  await app.inject({ method: "DELETE", url: `/api/conversas/${cA.id}/notas/${notaB.id}`, headers: as(donoA) });
  assert.equal(notes.forContact(cB.id).length, 1, "nota da outra loja continua");

  const equipeA = (await get(donoA, "/api/equipe", bikes.id)).json() as any[];
  assert.ok(equipeA.every((u) => u.store_id === carros.id));

  const simB = simulations.open(cB.id, bikes.id)!;
  assert.equal((await get(donoA, "/api/simulacoes")).json().length, 0);
  const patch = await app.inject({ method: "PATCH", url: `/api/simulacoes/${simB.id}`, headers: as(donoA), payload: { status: "aprovada" } });
  assert.equal(patch.statusCode, 404);
  const outroVend = await app.inject({ method: "PATCH", url: `/api/simulacoes/${simB.id}`, headers: as(donoB), payload: { seller_id: vendA.id } });
  assert.equal(outroVend.statusCode, 400, "não dá para passar a simulação para vendedor de outra loja");

  const ev = (await get(donoA, "/api/eventos")).json() as any[];
  assert.ok(ev.every((e) => e.store_id === carros.id));
});

test("admin troca de loja pelo cabeçalho e vê cada uma separada", async () => {
  const lA = (await get(admin, "/api/conversas", carros.id)).json() as any[];
  const lB = (await get(admin, "/api/conversas", bikes.id)).json() as any[];
  assert.ok(lA.every((c) => c.store_id === carros.id));
  assert.ok(lB.every((c) => c.store_id === bikes.id));
  const me = (await get(admin, "/api/me", bikes.id)).json();
  assert.equal(me.loja_atual.segmento, "bikes_eletricas");
});

test("fotos e áudios recebidos ficam na pasta da loja e só ela abre", async () => {
  const dir = storeDir("media", bikes.id);
  fs.writeFileSync(path.join(config.dataDir, "media", dir, "foto.jpg"), "x");
  assert.equal((await get(donoA, `/media/${dir}/foto.jpg`)).statusCode, 404);
  assert.equal((await get(donoB, `/media/${dir}/foto.jpg`)).statusCode, 200);
  assert.equal((await get(admin, `/media/${dir}/foto.jpg`)).statusCode, 200);
});

test("loja de bikes: IA fala de bike, busca por autonomia e não fala de km nem FIPE", async () => {
  const s = getSettings(bikes.id);
  assert.equal(s.loja.segmento, "bikes_eletricas");
  assert.equal(s.simulacao.pedir_cnh, false);
  const r = searchInventory(s, bikes.id, { autonomia_min: 100 });
  assert.deepEqual(r.veiculos.map((v: any) => v.id), ["v8max-iso"]);
  const card = searchInventory(s, bikes.id, { consulta: "duas baterias" }).veiculos[0] as any;
  assert.equal(card.id, "v8max-iso");
  assert.equal(card.km, undefined);
  assert.equal(card.ficha.Autonomia, "120 km");

  const tools = toolDefinitions(s);
  const busca = tools.find((t) => t.name === "buscar_estoque")!;
  assert.match(busca.description!, /bikes/);
  assert.ok(!tools.some((t) => /\bcarro/.test(t.description ?? "")), "nenhuma ferramenta fala de carro");
  const prompt = buildSystemPrompt(bikes.id, s);
  assert.match(prompt, /loja de bicicletas elétricas/);
  assert.match(prompt, /autonomia/);
  assert.ok(!/FIPE/.test(prompt));

  const c = await conversa(bikes.id, "5521911112222", "oi");
  const out = (await get(donoB, `/api/conversas/${c.id}`)).json().mensagens.filter((m: any) => m.direction === "out").map((m: any) => m.body).join(" ");
  assert.match(out, /bike/);
  assert.ok(!/carro/.test(out));
});

test("o dono não muda o segmento da loja; o admin muda", async () => {
  await app.inject({ method: "PUT", url: "/api/config", headers: as(donoA), payload: { loja: { segmento: "bikes_eletricas", cidade: "Niterói - RJ" } } });
  assert.equal(getSettings(carros.id).loja.segmento, "veiculos");
  assert.equal(getSettings(carros.id).loja.cidade, "Niterói - RJ");
  const nova = await app.inject({ method: "POST", url: "/api/lojas", headers: as(admin), payload: { nome: "Bikes do Recreio", segmento: "bikes_eletricas" } });
  assert.equal(getSettings(nova.json().id).loja.segmento, "bikes_eletricas");
  assert.equal(getSettings(nova.json().id).atendimento.aceita_troca, false);
});
