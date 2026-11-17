import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { contacts, leads, stores, users, vehicles } from "../src/db/repos.ts";
import { getSettings, saveSettings } from "../src/db/settings.ts";
import { receive } from "../src/pipeline/inbox.ts";
import { registerMarketing } from "../src/api/marketing.ts";
import { issueToken } from "../src/api/auth.ts";
import { buildTurnContext } from "../src/agent/prompt.ts";
import { segmentDefaults } from "../src/segments.ts";
import { matchCampaign } from "../src/marketing/repo.ts";

const loja = stores.create("Motos Centro", "motos-mkt");
saveSettings(loja.id, segmentDefaults("motos"));
const outra = stores.create("Outra", "outra-mkt");
const dono = users.create({ store_id: loja.id, role: "dono", nome: "Dono", email: "dono@mkt", senha: "senha-forte-1" });
const vend = users.create({ store_id: loja.id, role: "vendedor", nome: "Vend", email: "vend@mkt", senha: "senha-forte-1" });
const donoOutra = users.create({ store_id: outra.id, role: "dono", nome: "Dono 2", email: "dono2@mkt", senha: "senha-forte-1" });
vehicles.upsert({ id: "cg160-mkt", store_id: loja.id, marca: "Honda", modelo: "CG 160", ano_modelo: 2023, km: 12000, preco: 16900, fotos: [], videos: [], opcionais: [], destaques: ["Revisada"], ficha: { cilindrada_cc: "160" } } as any);

const app = Fastify();
registerMarketing(app);
await app.ready();
const h = (u: { id: number }) => ({ cookie: `arranque_sessao=${encodeURIComponent(issueToken(u.id))}` });
const call = (u: { id: number }, method: string, url: string, payload?: unknown) => app.inject({ method: method as any, url, headers: h(u), payload: payload as any });
const waitPlan = async (id: number) => {
  for (let i = 0; i < 50; i++) {
    const c = (await call(dono, "GET", `/api/marketing/campanhas/${id}`)).json();
    if (c.status !== "gerando") return c;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("plano não ficou pronto");
};

test("questionário: perguntas do segmento, respostas e preenchimento", async () => {
  const q = (await call(dono, "GET", "/api/marketing/questionario")).json();
  assert.equal(q.segmento, "motos");
  const uso = q.secoes.flatMap((s: any) => s.perguntas).filter((p: any) => p.id === "uso");
  assert.equal(uso.length, 1, "só a pergunta de uso do segmento de motos");
  assert.ok(uso[0].opcoes.some((o: any) => o.id === "entrega"));
  const r = (await call(dono, "PUT", "/api/marketing/questionario", { respostas: { bairros: "Centro, Tijuca", raio_km: 12, margem_pct: 12, ticket_medio: 17000, campo_inventado: "x" } })).json();
  assert.equal(r.respostas.campo_inventado, undefined);
  assert.ok(r.preenchimento.pct > 0 && r.preenchimento.pct < 100);
});

test("vendedor e outra loja não acessam o marketing", async () => {
  assert.equal((await call(vend, "GET", "/api/marketing/campanhas")).statusCode, 403);
  const c = (await call(dono, "POST", "/api/marketing/campanhas", { objetivo: "leads_whatsapp", verba_mensal: 3000, inicio: "2026-11-20", produtos: ["cg160-mkt"] })).json();
  await waitPlan(c.id);
  assert.equal((await call(donoOutra, "GET", `/api/marketing/campanhas/${c.id}`)).statusCode, 404);
  assert.equal((await call(donoOutra, "GET", "/api/marketing/campanhas")).json().length, 0);
});

test("campanha completa: plano da IA → ativa → lead do anúncio → resultados, CPL, ROAS e ROI", async () => {
  const c0 = (await call(dono, "POST", "/api/marketing/campanhas", { objetivo: "vendas", verba_mensal: 6000, inicio: "2026-11-20", canais: ["meta"], produtos: ["cg160-mkt"], observacoes: "foco em entregadores" })).json();
  assert.equal(c0.status, "gerando");
  const c = await waitPlan(c0.id);
  assert.equal(c.status, "rascunho");
  assert.ok(c.plano.estrutura.length >= 1);
  assert.ok(c.plano.estrutura[0].conjuntos[0].anuncios[0].texto_principal.includes("CG 160"));
  assert.ok(Math.abs(c.plano.orcamento.mensal - 6000) < 1);
  assert.ok(!/\bcarros?\b/i.test(JSON.stringify(c.plano)), "plano de loja de motos não fala de carro");

  // não ativa campanha de outra loja e ativa a própria
  assert.equal((await call(dono, "PATCH", `/api/marketing/campanhas/${c.id}`, { status: "ativa", palavras_anuncio: ["CG 160"] })).statusCode, 200);

  // duas campanhas ativas: o lead vai para a que bate com o título do anúncio
  const outraCamp = (await call(dono, "POST", "/api/marketing/campanhas", { objetivo: "leads_whatsapp", verba_mensal: 1000, inicio: "2026-11-20" })).json();
  await waitPlan(outraCamp.id);
  await call(dono, "PATCH", `/api/marketing/campanhas/${outraCamp.id}`, { status: "ativa", palavras_anuncio: ["XRE"] });
  assert.equal(matchCampaign(loja.id, { headline: "CG 160 revisada, entrada facilitada" }), c.id);
  assert.equal(matchCampaign(loja.id, { headline: "XRE 300" }), outraCamp.id);
  assert.equal(matchCampaign(loja.id, { headline: "Feirão" }), null, "com duas ativas e nenhuma pista, não chuta");

  for (const [i, wa] of ["5521911110001", "5521911110002", "5521911110003"].entries()) {
    await receive({ storeId: loja.id, channel: "whatsapp", waId: wa, profileName: `Lead ${i}`, waMessageId: `mkt${i}`, timestamp: new Date(), type: "text", text: "oi", referral: { headline: "CG 160 revisada", source_id: `ad-${i}`, ctwa_clid: `clid-${i}` } } as any);
  }
  const ls = ["5521911110001", "5521911110002", "5521911110003"].map((w) => contacts.byWaId(loja.id, w)!);
  assert.ok(ls.every((x) => x.campaign_id === c.id));
  leads.update(ls[0].id, { stage: "vendido", valor_venda: 16900 });
  leads.update(ls[1].id, { temperatura: "quente" });

  assert.ok(buildTurnContext(getSettings(loja.id), contacts.get(ls[2].id)!, leads.get(ls[2].id)!, { isNewSession: false }).includes(`Veio da campanha "${c.nome}"`));

  await call(dono, "POST", `/api/marketing/campanhas/${c.id}/resultados`, { data: "2026-11-20", investimento: 150, impressoes: 10000, cliques: 200, conversas: 3 });
  const m = (await call(dono, "POST", `/api/marketing/campanhas/${c.id}/resultados`, { data: "2026-11-21", investimento: 150, impressoes: 10000, cliques: 100 })).json();
  const k = m.kpis;
  assert.equal(k.investimento, 300);
  assert.equal(k.leads, 3);
  assert.equal(k.cpl, 100);
  assert.equal(k.qualificados, 2);
  assert.equal(k.vendas, 1);
  assert.equal(k.custo_por_venda, 300);
  assert.equal(Math.round(k.roas * 100) / 100, 56.33);
  assert.equal(k.ctr_pct, 1.5);
  // margem de 12%: lucro 2028 sobre 300 investidos = ROI de 576%
  assert.equal(k.roi_pct, 576);

  const geral = (await call(dono, "GET", "/api/marketing/resultados?dias=365")).json();
  assert.equal(geral.total.leads, 3);
  assert.equal(geral.campanhas.find((x: any) => x.id === c.id).kpis.vendas, 1);

  const an = (await call(dono, "POST", `/api/marketing/campanhas/${c.id}/analisar`)).json();
  assert.ok(an.resumo && an.acoes.length);
});

test("conta de anúncios: valida o ID e guarda o token sem devolver", async () => {
  assert.equal((await call(dono, "PUT", "/api/marketing/conta-anuncios", { conta: "abc" })).statusCode, 400);
  const s = (await call(dono, "PUT", "/api/marketing/conta-anuncios", { conta: "act_123456789", token: "EAAB-segredo" })).json();
  assert.deepEqual(s, { conta: "123456789", token_proprio: true, conectada: true });
  assert.ok(!JSON.stringify(s).includes("segredo"));
});
