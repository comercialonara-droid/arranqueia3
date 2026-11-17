import type Anthropic from "@anthropic-ai/sdk";
import { norm } from "../services/inventory.js";
import { PROFILES, vocab } from "../segments.js";

/**
 * MODO DE TESTE — não é a IA de verdade.
 * Segue regras simples por palavra-chave e chama as mesmas ferramentas que o Claude chamaria,
 * só para testar o fluxo (webhook → fila → ferramentas → envio → painel) sem chave de API.
 */
type Block = Anthropic.Beta.BetaContentBlock;
type Param = Anthropic.Beta.BetaMessageParam | { role: "system"; content: string };

let seq = 0;
const id = () => `toolu_mock_${Date.now()}_${seq++}`;
function msg(content: Block[], stop: Anthropic.Beta.BetaMessage["stop_reason"]): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_mock_${seq++}`,
    type: "message",
    role: "assistant",
    model: "mock",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as any,
  } as unknown as Anthropic.Beta.BetaMessage;
}
const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Block;
const tool = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", id: id(), name, input }) as unknown as Block;
const say = (t: string) => msg([text(t)], "end_turn");
const call = (name: string, input: Record<string, unknown>, before?: string) => msg([...(before ? [text(before)] : []), tool(name, input)], "tool_use");

function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b: any) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n");
}

const ASK: Record<string, string> = {
  "nome completo": "Pra eu já deixar sua simulação encaminhada, me passa seu nome completo?",
  CPF: "Agora seu CPF, por favor. Ele é usado só pra análise de crédito da loja, tá?",
  "data de nascimento": "E sua data de nascimento?",
  "se tem CNH": "Você tem CNH?",
  "forma de pagamento": "Você pensa em financiar, dar algum carro na troca ou pagar à vista?",
  "valor de entrada (ou se vai dar carro na troca)": "Quanto você teria de entrada? Ou pensa em dar um carro na troca?",
  "qual carro": "Qual carro te interessou aqui na loja?",
};

/** No modo de teste, a loja de bikes recebe as mesmas respostas com o vocabulário dela. */
export function mockRespond(messages: Param[], system = ""): Anthropic.Beta.BetaMessage {
  const r = mockRespondCars(messages);
  if (!/bicicletas el[eé]tricas/i.test(system.slice(0, 400))) return r;
  const p = PROFILES.bikes_eletricas;
  for (const b of r.content as any[]) if (b.type === "text") b.text = vocab(b.text, p).replace("🚗", "⚡");
  return r;
}

function mockRespondCars(messages: Param[]): Anthropic.Beta.BetaMessage {
  const real = messages.filter((m) => m.role !== "system") as Anthropic.Beta.BetaMessageParam[];
  const last = real[real.length - 1];
  const lastBlocks = Array.isArray(last?.content) ? (last.content as any[]) : [];
  const results = lastBlocks.filter((b) => b.type === "tool_result");

  if (results.length) {
    const prev = [...real].reverse().find((m) => m.role === "assistant");
    const calls = ((prev?.content as any[]) ?? []).filter((b) => b.type === "tool_use");
    const callName = calls[calls.length - 1]?.name;
    let data: any = {};
    try {
      data = JSON.parse(results[results.length - 1].content);
    } catch {}
    switch (callName) {
      case "buscar_estoque": {
        const v = data.veiculos?.[0] ?? data.alternativas?.[0];
        if (!v) return say("Poxa, esse eu não tenho agora 😕 Me conta o que você procura que eu vejo os parecidos.");
        return call("enviar_fotos", { veiculo_id: v.id, quantidade: 3 }, `Tenho sim! O ${v.como_chamar} tá aqui na loja 😊`);
      }
      case "enviar_fotos":
        return say("Esse tá muito inteiro! Quer que eu já veja uma simulação pra você? É rapidinho e sem compromisso.");
      case "atualizar_ficha":
      case "registrar_troca":
        return say(ASK["nome completo"]);
      case "registrar_dados_simulacao": {
        if (data.problemas?.length) return say("Acho que algum número veio trocado 😅 Confere pra mim, por favor?");
        if (data.pronto_para_enviar) return call("enviar_simulacao_para_vendedor", { resumo: "Cliente completou os dados da simulação (modo de teste)." }, "Perfeito! Vou passar tudo pro nosso consultor rodar sua simulação.");
        return say(ASK[data.falta?.[0]] ?? "Me conta mais um pouquinho?");
      }
      case "enviar_simulacao_para_vendedor":
        return say("Ele te chama aqui mesmo rapidinho 😉");
      case "horarios_disponiveis": {
        const h = data.horarios ?? [];
        if (!h.length) return say("Essa semana tá cheia. Pode ser na próxima?");
        return call("enviar_botoes", { texto: "Qual horário fica melhor pra você?", opcoes: h.slice(0, 3).map((x: any) => ({ id: `slot_${x.data}_${x.hora}`, titulo: x.rotulo_botao })) });
      }
      case "enviar_botoes":
        return say("[SEM_RESPOSTA]");
      case "agendar_visita":
        if (!data.agendado) return say(`Esse horário não dá: ${data.motivo}`);
        return call("enviar_localizacao_loja", {}, `Fechado! Te espero ${data.quando} 🚗`);
      case "enviar_localizacao_loja":
        return say("Qualquer coisa é só me chamar.");
      case "transferir_para_vendedor":
        return say("[SEM_RESPOSTA]");
      default:
        return say("Certo! Qualquer coisa é só falar.");
    }
  }

  const raw = blocksText(last?.content);
  const said = norm(raw);
  const prevAssistant = [...real].reverse().find((m) => m.role === "assistant");
  const prevText = norm(blocksText(prevAssistant?.content));

  const slot = said.match(/slot (\d{4} \d{2} \d{2}) (\d{2}) (\d{2})/);
  if (slot) {
    const [y, m, d] = slot[1].split(" ");
    return call("agendar_visita", { data: `${y}-${m}-${d}`, hora: `${slot[2]}:${slot[3]}`, tipo: "visita" });
  }
  const cpf = raw.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
  const nasc = raw.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
  if (cpf || nasc) return call("registrar_dados_simulacao", { cpf: cpf?.[0] ?? null, data_nascimento: nasc?.[0] ?? null, consentimento: true });
  if (prevText.includes("cnh") && /\b(sim|tenho|nao|n)\b/.test(said)) return call("registrar_dados_simulacao", { tem_cnh: !/\b(nao|n)\b/.test(said) });
  if (prevText.includes("nome completo") && raw.trim().split(/\s+/).length >= 2) return call("registrar_dados_simulacao", { nome_completo: raw.trim() });
  if (/vendedor|humano|atendente|pessoa|desconto/.test(said))
    return call("transferir_para_vendedor", { motivo: "pediu_humano", resumo: "Cliente pediu atendimento humano (modo de teste).", urgente: false }, "Claro! Vou chamar um dos nossos consultores, ele continua com você aqui mesmo.");
  if (/visita|agendar|amanha|horario|passar ai|test ride|test drive/.test(said)) return call("horarios_disponiveis", {});
  if (/\bquanto (ta|custa|fica|sai|e)\b|preco|valor/.test(said)) return say("O valor certinho e a melhor condição o consultor passa na simulação, que é rapidinha. Quer que eu já encaminhe a sua?");
  if (/troca/.test(said)) return call("registrar_troca", { modelo: null, fotos_recebidas: false }, "Aceitamos sim seu carro na troca!");
  if (/simula|financ|parcela|entrada|^sim|quero|bora/.test(said)) {
    const entrada = said.match(/(\d+)\s*mil/);
    return call("atualizar_ficha", { intencao: "simulacao", forma_pagamento: /vista/.test(said) ? "a_vista" : "financiamento", entrada: entrada ? Number(entrada[1]) * 1000 : null });
  }
  if (/visita|agendar|amanha|horario|passar ai/.test(said)) return call("horarios_disponiveis", {});
  if (/^(oi|ola|bom dia|boa tarde|boa noite|eai|e ai)\b/.test(said) && said.split(" ").length <= 4) return say("Oi! Tudo bem? 😊 Tá procurando algum carro em especial?");
  return call("buscar_estoque", { consulta: raw.slice(0, 120), limite: 3 });
}
