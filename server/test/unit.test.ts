import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pricePmt, simulate, solveRate, maxVehicleForInstallment } from "../src/services/financing.ts";
import { defaultSettings, deepMerge } from "../src/db/settings.ts";
import { parseCsv, parseNumberBR } from "../src/util/csv.ts";
import { validSignature, parseMessage } from "../src/whatsapp/webhook.ts";
import { sanitizeSchema, toolDefinitions } from "../src/agent/tools.ts";
import { splitIntoBubbles } from "../src/pipeline/outbox.ts";
import { scoreLead } from "../src/services/scoring.ts";
import { fromZoned, zonedParts } from "../src/util/time.ts";

test("parcela pela tabela Price", () => {
  // 80 mil em 48x a 1,99% a.m. ≈ R$ 2.602,84
  assert.ok(Math.abs(pricePmt(80000, 1.99, 48) - 2602.84) < 0.01);
  assert.equal(pricePmt(0, 2, 48), 0);
});

test("regra prática da loja: a cada 30 mil financiados, 1 mil de parcela", () => {
  const cfg = { ...defaultSettings.financiamento, modo: "regra_loja" as const };
  const sim = simulate(cfg, 115900, 25900);
  assert.equal(sim.valor_financiado, 90000);
  assert.equal(sim.opcoes[0].parcela, 3000);
  assert.equal(sim.opcoes[0].prazo, 48);
});

test("entrada abaixo do mínimo é sinalizada", () => {
  const sim = simulate(defaultSettings.financiamento, 100000, 5000);
  assert.equal(sim.entrada_abaixo_do_minimo, true);
  assert.equal(sim.entrada_minima, 20000);
});

test("taxa implícita e teto por parcela", () => {
  const r = solveRate(30000, 1000, 48);
  assert.ok(r > 1.5 && r < 2.5);
  const cfg = { ...defaultSettings.financiamento, modo: "regra_loja" as const };
  assert.equal(maxVehicleForInstallment(cfg, 2000, 20000), 80000);
});

test("mescla profunda de configurações", () => {
  const m = deepMerge(defaultSettings, { loja: { nome: "X" }, financiamento: { prazos: [12] } });
  assert.equal(m.loja.nome, "X");
  assert.equal(m.loja.cidade, defaultSettings.loja.cidade);
  assert.deepEqual(m.financiamento.prazos, [12]);
});

test("CSV com ponto e vírgula, aspas e valores em reais", () => {
  const rows = parseCsv('marca;modelo;preco;descricao\nToyota;Corolla;"R$ 115.900,00";"Muito novo; revisado"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].descricao, "Muito novo; revisado");
  assert.equal(parseNumberBR(rows[0].preco), 115900);
  assert.equal(parseNumberBR("79 mil"), 79000);
  assert.equal(parseNumberBR("117.000"), 117000);
  assert.equal(parseNumberBR(""), null);
});

test("assinatura do webhook da Meta", () => {
  const raw = Buffer.from('{"a":1}');
  const sig = "sha256=" + crypto.createHmac("sha256", "seg").update(raw).digest("hex");
  assert.equal(validSignature(raw, sig, "seg"), true);
  assert.equal(validSignature(raw, sig, "outro"), false);
  assert.equal(validSignature(raw, undefined, "seg"), false);
});

test("mensagens do webhook viram o formato interno", () => {
  const txt = parseMessage(
    { from: "5521999990000", id: "wamid.1", timestamp: "1763390000", type: "text", text: { body: "oi" }, referral: { ctwa_clid: "abc", headline: "Corolla" } },
    "Ana",
  );
  assert.equal(txt.text, "oi");
  assert.equal(txt.referral?.ctwa_clid, "abc");
  const btn = parseMessage({ from: "1", id: "2", timestamp: "1", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "x", title: "Sim" } } }, null);
  assert.deepEqual(btn.interactive, { id: "x", title: "Sim" });
  const img = parseMessage({ from: "1", id: "3", timestamp: "1", type: "image", image: { id: "m1", mime_type: "image/jpeg", caption: "meu carro" } }, null);
  assert.equal(img.mediaId, "m1");
  assert.equal(img.caption, "meu carro");
});

test("schemas das ferramentas ficam compatíveis com o modo strict", () => {
  const all = JSON.stringify(toolDefinitions());
  assert.ok(!all.includes("minimum"));
  assert.ok(!all.includes('"type":["'));
  for (const t of toolDefinitions()) {
    assert.equal(t.strict, true);
    assert.equal((t.input_schema as any).additionalProperties, false);
  }
  assert.deepEqual(sanitizeSchema({ type: ["string", "null"], description: "d" }), { description: "d", anyOf: [{ type: "string" }, { type: "null" }] });
});

test("resposta longa vira até 4 balões", () => {
  assert.deepEqual(splitIntoBubbles("a\n\nb\n\nc"), ["a", "b", "c"]);
  assert.equal(splitIntoBubbles("1\n\n2\n\n3\n\n4\n\n5\n\n6").length, 4);
});

test("pontuação do lead", () => {
  const base = { interesse: [] as string[], interesse_texto: null, forma_pagamento: null, entrada: null, orcamento_max: null, parcela_max: null, tem_troca: null, urgencia: null, bairro: null, cidade: null } as any;
  assert.equal(scoreLead(base, null).temperatura, "frio");
  const hot = scoreLead({ ...base, interesse: ["x"], forma_pagamento: "financiamento", entrada: 20000, urgencia: "imediata" }, null, { visitaAgendada: true });
  assert.equal(hot.temperatura, "quente");
});

test("fuso horário da loja (São Paulo)", () => {
  const d = fromZoned("2026-11-18", "10:00");
  assert.equal(d.toISOString(), "2026-11-18T13:00:00.000Z");
  assert.equal(zonedParts(d).time, "10:00");
});
