/**
 * IA estrategista de tráfego pago: lê o questionário da loja, o estoque e o histórico e escreve o plano da campanha.
 * IA analista: lê os resultados (investimento, custo por lead, funil até a venda) e diz o que ajustar.
 */
import { config } from "../config.js";
import { getSettings } from "../db/settings.js";
import { effectivePrice, vehicles, vehicleTitle } from "../db/repos.js";
import { profileOf, specLines } from "../segments.js";
import { anthropic } from "../agent/runner.js";
import { log } from "../util/log.js";
import { brl } from "../util/time.js";
import { nowIso } from "../db/index.js";
import { briefingText } from "./questionnaire.js";
import { briefings, campaigns, type Campaign } from "./repo.js";
import { campaignMetrics, storeMarketing } from "./metrics.js";
import { ANALYSIS_SCHEMA, PLAN_SCHEMA, type CampaignPlan, type ResultsAnalysis } from "./plan.js";

const OBJETIVOS: Record<string, string> = {
  leads_whatsapp: "gerar conversas no WhatsApp (leads) para a IA de atendimento qualificar",
  visitas: "trazer visitas à loja",
  vendas: "vender (otimizar para quem compra)",
  marca: "tornar a loja conhecida na região",
};

function productLines(storeId: number, ids: string[]) {
  const s = getSettings(storeId);
  const p = profileOf(s);
  const all = vehicles.available(storeId);
  const chosen = ids.length ? all.filter((v) => ids.includes(v.id)) : all.filter((v) => v.destaque).concat(all.filter((v) => !v.destaque)).slice(0, 12);
  return chosen.map((v) => {
    const preco = effectivePrice(v);
    const ficha = Object.entries(specLines(p, v.ficha)).map(([k, x]) => `${k} ${x}`);
    return `- [${v.id}] ${vehicleTitle(v)}${preco ? ` · ${brl(preco)}` : ""}${v.km != null && !p.esconder.includes("km") ? ` · ${v.km.toLocaleString("pt-BR")} km` : ""}${ficha.length ? ` · ${ficha.join(", ")}` : ""}${v.destaques.length ? ` · destaques: ${v.destaques.slice(0, 4).join(", ")}` : ""} · ${v.fotos.length} fotos, ${v.videos.length} vídeos`;
  });
}

function storeContext(storeId: number) {
  const s = getSettings(storeId);
  const p = profileOf(s);
  const a = s.atendimento;
  return [
    `Loja: ${s.loja.nome} (${s.loja.tipo_loja || p.tipo_loja}), ${s.loja.cidade}. Endereço: ${s.loja.endereco || "não informado"}${s.loja.referencia ? ` (${s.loja.referencia})` : ""}.`,
    `Segmento: ${p.nome}. Instagram: ${s.loja.instagram || "não informado"}.`,
    `Política de preço no WhatsApp: ${a.politica_preco === "so_vendedor" ? "a IA não fala valores; preço só com o consultor na simulação" : a.politica_preco === "parcela_primeiro" ? "destaca entrada + parcela" : "informa o preço"}.`,
    `${a.aceita_troca ? `Aceita ${p.troca_item} na troca.` : "Não aceita troca."} ${a.aceita_financiamento ? "Trabalha com financiamento/parcelamento." : "Não financia."}`,
    `Diferenciais cadastrados: ${a.diferenciais.join("; ") || "nenhum"}. Garantia: ${a.garantia}.`,
  ].join("\n");
}

function historyContext(storeId: number, exceptId?: number) {
  const prev = campaigns
    .list(storeId)
    .filter((c) => c.id !== exceptId && c.plano && ["ativa", "pausada", "encerrada"].includes(c.status))
    .slice(0, 5)
    .map((c) => {
      const k = campaignMetrics(c).kpis;
      return `- "${c.nome}" (${c.status}): investimento ${brl(k.investimento)}, ${k.leads} leads, CPL ${k.cpl ? brl(k.cpl) : "—"}, ${k.qualificados} qualificados, ${k.vendas} vendas, ROAS ${k.roas?.toFixed(1) ?? "—"}`;
    });
  return prev.length ? prev.join("\n") : "Nenhuma campanha anterior com resultado no sistema.";
}

/** Produtos da campanha: os escolhidos no pedido ou, sem escolha, os do questionário. */
function focusIds(c: Campaign): string[] {
  if (c.pedido.produtos.length) return c.pedido.produtos;
  const f = briefings.get(c.store_id).respostas.produtos_foco;
  return Array.isArray(f) ? (f as string[]).filter((id) => vehicles.get(id, c.store_id)) : [];
}

const SYSTEM_PLAN = `Você é o estrategista de tráfego pago da ArranqueIA, especialista em anúncios para lojas de veículos (carros, motos e bicicletas elétricas) no Brasil, com foco em anúncios de clique para o WhatsApp.

Como a ArranqueIA funciona: os anúncios levam o cliente para o WhatsApp da loja, onde uma IA de atendimento responde em segundos, manda fotos e vídeos do estoque, entende a forma de pagamento, faz a pré-simulação e passa o lead pronto para o vendedor. O plano tem que aproveitar isso: a métrica que importa não é só o custo por conversa, é o custo por lead qualificado e por venda.

Escreva um plano de campanha completo, profissional e pronto para executar, em português do Brasil:
- Use SOMENTE produtos do estoque informado (cite o modelo) e as condições que a loja informou. Não invente preço, condição, garantia ou prêmio.
- Respeite a verba: a soma dos orçamentos diários × 30 deve ficar perto da verba mensal. Distribua entre teste de criativos, escala do que funciona e remarketing (quem já interagiu com o perfil ou conversou no WhatsApp).
- Estrutura enxuta e testável: poucas campanhas, conjuntos com públicos claros e 2 a 4 anúncios por conjunto com ganchos diferentes. Para verbas baixas, menos conjuntos.
- Públicos com localização real da loja (bairros e raio informados), idade, interesses e exclusões. Use públicos amplos quando a verba permitir e explique.
- Anúncios prontos: gancho forte nos primeiros segundos, texto curto com a condição e a chamada para o WhatsApp, roteiro do criativo (o que filmar ou fotografar com o material que a loja tem) e a mensagem inicial que o cliente já encontra no WhatsApp.
- Metas realistas para o mercado e a verba, coerentes entre si (leads × taxa de qualificação × conversão = vendas). Se faltar dado, assuma o razoável e diga no diagnóstico o que assumiu.
- Regras de otimização objetivas (ex.: "CPL acima de R$ X por 3 dias no conjunto Y → pausar o anúncio pior e duplicar o melhor").
- Anúncio de veículo com financiamento: não prometa aprovação de crédito, não use "sem consulta ao SPC", não discrimine público por idade/gênero de forma proibida. Avise nos riscos o que a política da Meta e a lei exigem.
- Integração com o atendimento: diga como a IA do WhatsApp deve receber os leads desta campanha (oferta a confirmar, perguntas certas, quando oferecer simulação ou visita).`;

/** Gera o plano em segundo plano; a campanha fica "gerando" até terminar. */
export async function generatePlan(campaignId: number): Promise<void> {
  const c = campaigns.get(campaignId);
  if (!c) return;
  const s = getSettings(c.store_id);
  const p = profileOf(s);
  try {
    let plan: CampaignPlan;
    if (config.ai.provider === "mock") plan = mockPlan(c);
    else {
      const prompt = `${storeContext(c.store_id)}

# Questionário da loja
${briefingText(p.id, briefings.get(c.store_id).respostas, (id) => {
  const v = vehicles.get(id, c.store_id);
  return v ? vehicleTitle(v) : null;
})}

# Estoque para anunciar
${productLines(c.store_id, focusIds(c)).join("\n") || "(estoque vazio)"}

# Histórico de campanhas
${historyContext(c.store_id, c.id)}

# Pedido desta campanha
- Objetivo: ${OBJETIVOS[c.pedido.objetivo] ?? c.pedido.objetivo}
- Verba mensal: ${brl(c.pedido.verba_mensal)}
- Período: de ${c.pedido.inicio}${c.pedido.fim ? ` até ${c.pedido.fim}` : " (contínua)"}
- Canais: ${c.pedido.canais.join(", ") || "Instagram e Facebook"}
${c.pedido.observacoes ? `- Observações do gestor: ${c.pedido.observacoes}` : ""}

Hoje é ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Escreva o plano.`;
      const stream = anthropic().beta.messages.stream({
        model: config.ai.model,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: PLAN_SCHEMA } },
        system: SYSTEM_PLAN,
        messages: [{ role: "user", content: prompt }],
      } as any);
      const resp = await stream.finalMessage();
      if (resp.stop_reason === "refusal") throw new Error("A IA recusou escrever este plano. Revise o pedido e tente de novo.");
      if (resp.stop_reason === "max_tokens") throw new Error("O plano ficou grande demais. Reduza canais ou produtos e tente de novo.");
      const block = resp.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("A IA não devolveu o plano.");
      plan = JSON.parse(block.text);
    }
    const palavras = [...new Set(plan.estrutura.flatMap((e) => e.conjuntos.flatMap((cj) => cj.anuncios.map((a) => a.produto_destaque))).filter((x) => x && !/institucional/i.test(x)))].slice(0, 10);
    campaigns.update(c.id, { plano: plan, nome: plan.nome || c.nome, status: "rascunho", erro: null, palavras_anuncio: c.palavras_anuncio.length ? c.palavras_anuncio : palavras });
    log.info("plano de campanha gerado", { campaignId: c.id });
  } catch (e) {
    log.error("falha ao gerar plano", { campaignId: c.id, err: (e as Error).message });
    campaigns.update(c.id, { status: "erro", erro: (e as Error).message });
  }
}

/** Lê os resultados da campanha e devolve diagnóstico e ações. */
export async function analyzeCampaign(campaignId: number): Promise<ResultsAnalysis & { atualizado_em: string }> {
  const c = campaigns.get(campaignId)!;
  const m = campaignMetrics(c);
  const k = m.kpis;
  let a: ResultsAnalysis;
  if (config.ai.provider === "mock") a = mockAnalysis(c, k);
  else {
    const ultimos = m.serie.slice(-14).map((d) => `${d.data}: investimento ${brl(d.investimento)}, ${d.leads} leads${d.cpl ? `, CPL ${brl(d.cpl)}` : ""}`);
    const prompt = `${storeContext(c.store_id)}

# Campanha "${c.nome}" (${c.status}), de ${c.inicio ?? "?"} ${c.fim ? `a ${c.fim}` : "(contínua)"}
Metas do plano: ${JSON.stringify(m.metas ?? {})}
Resumo da estratégia: ${c.plano?.resumo ?? "-"}

# Resultado acumulado
Investimento ${brl(k.investimento)} · impressões ${k.impressoes} · cliques ${k.cliques} (CTR ${k.ctr_pct ?? "—"}%, CPC ${k.cpc ? brl(k.cpc) : "—"}) · conversas na plataforma ${k.conversas_plataforma}
Leads no WhatsApp ${k.leads} (CPL ${k.cpl ? brl(k.cpl) : "—"}) · qualificados pela IA ${k.qualificados} (${k.taxa_qualificacao_pct ?? "—"}%, custo ${k.custo_qualificado ? brl(k.custo_qualificado) : "—"})
Simulações ${k.simulacoes} · visitas ${k.visitas} · vendas ${k.vendas} (custo por venda ${k.custo_por_venda ? brl(k.custo_por_venda) : "—"}) · receita ${brl(k.receita)} · ROAS ${k.roas?.toFixed(2) ?? "—"} · ROI ${k.roi_pct ?? "—"}% (margem ${k.margem_pct ?? "não informada"}%)

# Dia a dia (últimos 14)
${ultimos.join("\n") || "sem dados diários"}

Analise como um gestor de tráfego sênior: o que está bom, o que está ruim (e se o gargalo é o anúncio, o público, a oferta ou o atendimento/vendas), e as ações concretas, em ordem de prioridade.`;
    const resp = await anthropic().beta.messages.create({
      model: config.ai.model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
      system: "Você é gestor de tráfego sênior de lojas de veículos no Brasil. Seja direto e específico, com números. Não invente dados que não estão no relatório. Português do Brasil.",
      messages: [{ role: "user", content: prompt }],
    } as any);
    if (resp.stop_reason === "refusal") throw new Error("A IA não conseguiu analisar esta campanha.");
    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("Resposta vazia da IA.");
    a = JSON.parse(block.text);
  }
  const analise = { ...a, atualizado_em: nowIso() };
  campaigns.update(c.id, { analise });
  return analise;
}

// ───────────────────────── modo de teste (sem chave da API) ─────────────────────────

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function mockPlan(c: Campaign): CampaignPlan {
  const s = getSettings(c.store_id);
  const p = profileOf(s);
  const r = briefings.get(c.store_id).respostas as Record<string, any>;
  const foco = focusIds(c);
  const prods = vehicles.available(c.store_id).filter((v) => !foco.length || foco.includes(v.id)).slice(0, 3);
  const verba = c.pedido.verba_mensal || 3000;
  const diario = Math.round(verba / 30);
  const raio = Number(r.raio_km) || 15;
  const local = String(r.bairros || s.loja.cidade);
  const cond = (r.condicoes as string[] | undefined)?.includes("entrada_facilitada") ? "entrada facilitada" : s.atendimento.aceita_financiamento ? "parcelas que cabem no bolso" : "pagamento facilitado";
  const ticket = Number(r.ticket_medio) || (prods[0] ? effectivePrice(prods[0]) ?? 50000 : 50000);
  const cpl = p.id === "bikes_eletricas" ? 12 : p.id === "motos" ? 15 : 25;
  const leads = Math.round(verba / cpl);
  const vendas = Math.max(1, Math.round(leads * 0.03));
  const anuncio = (v: (typeof prods)[number] | undefined, i: number) => {
    const nome = v ? vehicleTitle(v) : `${cap(p.produto)} do estoque`;
    const curto = v ? `${v.modelo}` : p.produto;
    return {
      nome: `A${i + 1} · ${curto}`,
      formato: (i % 2 ? "carrossel" : "video_reels") as "carrossel" | "video_reels",
      produto_destaque: v ? `${v.marca} ${v.modelo}` : "institucional",
      gancho: i % 2 ? `${curto} com ${cond} em ${s.loja.cidade.split(" - ")[0]}` : `Olha ${p.esse.replace(p.produto, curto)} que chegou 👀`,
      texto_principal: `${nome} na ${s.loja.nome}. ${v?.destaques.slice(0, 2).join(", ") || "Pronta entrega"}. Chama no WhatsApp que a gente te responde na hora e já vê a condição pra você.`,
      titulo: `${curto} com ${cond}`.slice(0, 40),
      chamada: "Enviar mensagem",
      roteiro_criativo: i % 2 ? "4 a 6 fotos: frente 3/4, lateral, interior/painel, detalhe do destaque e uma foto com o preço ou a condição." : `Vídeo vertical de 15 a 20 s: começa com ${p.o} em movimento ou girando, texto na tela com a condição, close nos destaques e final com "chama no WhatsApp".`,
      mensagem_inicial_whatsapp: `Oi! Vi o anúncio ${p.do.replace(p.produto, curto)} e quero saber mais`,
    };
  };
  return {
    nome: `${prods[0] ? prods[0].modelo : cap(p.produto)} · ${c.pedido.objetivo === "vendas" ? "Vendas" : "Leads WhatsApp"} · ${new Date().toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}`,
    resumo: `Plano de exemplo (modo de teste, sem a IA de verdade). Anúncios de clique para o WhatsApp com os produtos de maior apelo, num raio de ${raio} km da loja, testando dois tipos de criativo e reforçando com remarketing de quem já interagiu. A IA de atendimento recebe os leads, qualifica e passa ao vendedor.`,
    diagnostico: [
      `Verba de ${brl(verba)} por mês (~${brl(diario)} por dia).`,
      r.vendas_mes ? `Hoje vende ${r.vendas_mes} por mês; meta de ${r.meta_vendas_mes ?? "?"}.` : "Vendas atuais não informadas no questionário.",
      `Ticket médio considerado: ${brl(ticket)}.`,
      "Ligue a IA (chave da Anthropic) para um diagnóstico de verdade.",
    ],
    posicionamento: `A ${p.tipo_loja} de ${local.split(",")[0]} que responde na hora e facilita a compra.`,
    oferta_principal: `${prods[0] ? vehicleTitle(prods[0]) : cap(p.produto)} com ${cond}`,
    publicos: [
      { nome: "Amplo regional", temperatura: "frio", descricao: "Pessoas na região da loja, sem interesse definido: deixa o algoritmo achar quem conversa.", localizacao: local, raio_km: raio, idade_min: 22, idade_max: 60, interesses: [], exclusoes: ["Quem já conversou no WhatsApp nos últimos 30 dias"] },
      { nome: `Interesse em ${p.produtos}`, temperatura: "frio", descricao: `Interessados em ${p.produtos}, financiamento e marcas do estoque.`, localizacao: local, raio_km: raio, idade_min: 22, idade_max: 55, interesses: [p.produtos, "Financiamento", ...prods.map((v) => v.marca)], exclusoes: [] },
      { nome: "Remarketing", temperatura: "quente", descricao: "Quem interagiu com o Instagram/Facebook ou viu 50% dos vídeos nos últimos 30 dias.", localizacao: local, raio_km: raio + 10, idade_min: 18, idade_max: 65, interesses: [], exclusoes: ["Clientes que já compraram"] },
    ],
    estrutura: [
      {
        nome: "[WPP] Teste e escala",
        plataforma: "meta",
        objetivo_plataforma: "Engajamento > Conversas por mensagem (WhatsApp)",
        otimizacao: "Conversas",
        fase: "teste e escala",
        orcamento_diario: Math.round(diario * 0.8),
        conjuntos: [
          { nome: "Amplo regional", publico: "Amplo regional", posicionamentos: "Automáticos (Advantage+)", orcamento_diario: Math.round(diario * 0.45), anuncios: [anuncio(prods[0], 0), anuncio(prods[1] ?? prods[0], 1)] },
          { nome: `Interesse ${p.produtos}`, publico: `Interesse em ${p.produtos}`, posicionamentos: "Reels, Stories e Feed", orcamento_diario: Math.round(diario * 0.35), anuncios: [anuncio(prods[2] ?? prods[0], 2), anuncio(prods[0], 3)] },
        ],
      },
      {
        nome: "[WPP] Remarketing",
        plataforma: "meta",
        objetivo_plataforma: "Engajamento > Conversas por mensagem (WhatsApp)",
        otimizacao: "Conversas",
        fase: "remarketing",
        orcamento_diario: Math.round(diario * 0.2),
        conjuntos: [{ nome: "Engajados 30 dias", publico: "Remarketing", posicionamentos: "Stories e Feed", orcamento_diario: Math.round(diario * 0.2), anuncios: [anuncio(prods[0], 4)] }],
      },
    ],
    orcamento: {
      mensal: verba,
      diario,
      distribuicao: [
        { item: "Teste de criativos e públicos", percentual: 45, valor: Math.round(verba * 0.45), motivo: "Descobrir o anúncio e o público com menor custo por lead qualificado." },
        { item: "Escala dos vencedores", percentual: 35, valor: Math.round(verba * 0.35), motivo: "Colocar mais verba onde o lead qualifica mais." },
        { item: "Remarketing", percentual: 20, valor: Math.round(verba * 0.2), motivo: "Quem já se interessou converte mais barato." },
      ],
    },
    metas: { cpl_alvo: cpl, leads_mes: leads, taxa_qualificacao_pct: 35, vendas_mes: vendas, roas_alvo: Math.round(((vendas * ticket) / verba) * 10) / 10, custo_por_venda_max: Math.round(verba / vendas) },
    cronograma: [
      { periodo: "Semana 1", foco: "Lançamento e aprendizado", acoes: ["Subir as campanhas", "Não mexer por 3 dias", "Conferir se os leads chegam na ArranqueIA com a campanha certa"] },
      { periodo: "Semana 2", foco: "Primeira otimização", acoes: ["Pausar anúncios com CPL 50% acima da meta", "Duplicar o melhor anúncio com novo gancho"] },
      { periodo: "Semanas 3 e 4", foco: "Escala", acoes: ["Subir 20% a verba do melhor conjunto a cada 3 dias", "Gravar 2 criativos novos com o produto que mais qualificou"] },
    ],
    regras_otimizacao: [
      { quando: `CPL acima de ${brl(cpl * 1.5)} por 3 dias seguidos num anúncio`, acao: "Pausar o anúncio e testar um gancho novo." },
      { quando: "Taxa de qualificação abaixo de 20%", acao: "Revisar público e oferta: os leads chegam mas não têm perfil." },
      { quando: `CPL abaixo de ${brl(cpl * 0.7)} e qualificação acima de 35%`, acao: "Aumentar a verba do conjunto em 20%." },
    ],
    integracao_atendimento: [
      "Confirmar o produto do anúncio logo na primeira resposta e mandar as fotos.",
      "Perguntar o uso e a forma de pagamento antes de oferecer a simulação.",
      "Lead de remarketing já conhece a loja: oferecer simulação ou visita mais cedo.",
    ],
    checklist_lancamento: ["Número de WhatsApp da loja conectado na ArranqueIA", "Conta de anúncios e forma de pagamento ativas", "Criativos gravados", "Campanha cadastrada aqui com os IDs da Meta para os resultados entrarem sozinhos"],
    riscos: ["Anúncio com financiamento não pode prometer aprovação de crédito.", "Verba diária muito baixa deixa o aprendizado lento: concentre em poucos conjuntos."],
  };
}

function mockAnalysis(c: Campaign, k: ReturnType<typeof campaignMetrics>["kpis"]): ResultsAnalysis {
  const meta = c.plano?.metas;
  const cplRuim = meta && k.cpl && k.cpl > meta.cpl_alvo * 1.3;
  return {
    resumo: `Análise de exemplo (modo de teste). ${brl(k.investimento)} investidos, ${k.leads} leads${k.cpl ? ` a ${brl(k.cpl)} cada` : ""}, ${k.qualificados} qualificados e ${k.vendas} vendas.`,
    nota: !k.investimento ? "atencao" : cplRuim ? "atencao" : k.vendas > 0 ? "boa" : "atencao",
    pontos_fortes: k.leads ? ["A campanha já gera conversas no WhatsApp."] : [],
    problemas: [!k.investimento ? "Ainda não há investimento registrado: lance os resultados ou conecte a conta de anúncios." : null, cplRuim ? "Custo por lead acima da meta." : null].filter(Boolean) as string[],
    acoes: [{ prioridade: "alta", acao: "Ligar a IA para uma análise de verdade", motivo: "Esta é uma resposta pronta do modo de teste." }],
    previsao: "Com a IA ligada, a análise traz a previsão das próximas semanas.",
  };
}

/** Resumo de marketing para o contexto do painel de resultados (usado pela análise geral). */
export const overview = storeMarketing;
