import type Anthropic from "@anthropic-ai/sdk";
import { norm } from "../services/inventory.js";

/**
 * Modelo simulado para testar o fluxo inteiro (webhook → fila → ferramentas → envio → painel) sem chave de API.
 * Ele segue regras simples por palavra-chave e chama as mesmas ferramentas que o Claude chamaria.
 * Não use em produção: as respostas são fixas e sem inteligência.
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

function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function mockRespond(messages: Param[]): Anthropic.Beta.BetaMessage {
  const real = messages.filter((m) => m.role !== "system") as Anthropic.Beta.BetaMessageParam[];
  const last = real[real.length - 1];
  const lastBlocks = Array.isArray(last?.content) ? (last.content as any[]) : [];

  // Depois de uma ferramenta: escreve a resposta com base no resultado
  const results = lastBlocks.filter((b) => b.type === "tool_result");
  if (results.length) {
    const prevAssistant = [...real].reverse().find((m) => m.role === "assistant");
    const calls = (prevAssistant?.content as any[]).filter((b) => b.type === "tool_use");
    const call = calls[calls.length - 1];
    const data = (() => {
      try {
        return JSON.parse(results[results.length - 1].content);
      } catch {
        return {};
      }
    })();
    switch (call?.name) {
      case "buscar_estoque": {
        const v = data.veiculos?.[0] ?? data.alternativas?.[0];
        if (!v) return msg([text("Poxa, não achei nada assim no estoque agora. Me conta um pouco mais do que você procura?")], "end_turn");
        return msg(
          [
            text(
              `Tenho sim! *${v.titulo}*\n• ${v.km} · ${v.cambio ?? ""} · ${v.combustivel ?? ""}\n• ${v.preco}${v.parcela_estimada ? `\n• ${v.parcela_estimada}*` : ""}`,
            ),
            tool("enviar_fotos", { veiculo_id: v.id, quantidade: 3 }),
          ],
          "tool_use",
        );
      }
      case "enviar_fotos":
        return msg([text("Gostou? Quer vir ver ele pessoalmente? Tenho horário amanhã 🙂")], "end_turn");
      case "simular_financiamento":
        return msg([text(`Simulei aqui: entrada de ${data.entrada} + ${data.opcoes?.slice(-1)[0] ?? ""}.\n\n${data.observacao ?? ""}\n\nQuer agendar uma visita?`)], "end_turn");
      case "horarios_disponiveis": {
        const h = data.horarios ?? [];
        if (!h.length) return msg([text("Essa semana está cheia. Pode ser na próxima?")], "end_turn");
        return msg([tool("enviar_botoes", { texto: "Qual horário fica melhor pra você?", opcoes: h.slice(0, 3).map((x: any, i: number) => ({ id: `slot_${x.data}_${x.hora}`, titulo: x.rotulo_botao })) })], "tool_use");
      }
      case "enviar_botoes":
        return msg([text("[SEM_RESPOSTA]")], "end_turn");
      case "agendar_visita":
        if (!data.agendado) return msg([text(`Esse horário não dá: ${data.motivo}`)], "end_turn");
        return msg([text(`Fechado! Te espero ${data.quando} 🚗`), tool("enviar_localizacao_loja", {})], "tool_use");
      case "enviar_localizacao_loja":
        return msg([text("Qualquer coisa é só chamar aqui.")], "end_turn");
      case "transferir_para_vendedor":
        return msg([text("Prontinho, já chamei um consultor. Ele continua com você aqui mesmo.")], "end_turn");
      default:
        return msg([text("Certo! Posso te ajudar com mais alguma coisa?")], "end_turn");
    }
  }

  const said = norm(blocksText(last?.content));
  const slot = said.match(/slot (\d{4} \d{2} \d{2}) (\d{2}) (\d{2})/);
  if (slot) {
    const [y, m, d] = slot[1].split(" ");
    return msg([tool("agendar_visita", { data: `${y}-${m}-${d}`, hora: `${slot[2]}:${slot[3]}`, tipo: "visita" })], "tool_use");
  }
  if (/vendedor|humano|atendente|pessoa|desconto/.test(said)) {
    return msg([text("Claro! Vou chamar um dos nossos consultores."), tool("transferir_para_vendedor", { motivo: "pediu_humano", resumo: "Cliente pediu atendimento humano (modo simulado).", urgente: false })], "tool_use");
  }
  if (/parcela|financ|entrada/.test(said)) {
    const prevCar = findLastVehicleId(real);
    return msg([tool("simular_financiamento", { veiculo_id: prevCar, valor: prevCar ? null : 80000, entrada: null, prazo: null })], "tool_use");
  }
  if (/visita|agendar|amanha|horario|ir ai|passar ai/.test(said)) return msg([tool("horarios_disponiveis", {})], "tool_use");
  if (/^(oi|ola|bom dia|boa tarde|boa noite|eai|e ai)\b/.test(said) && said.split(" ").length <= 4) {
    return msg([text("Oi! Tudo bem? 😊 Aqui é a assistente da loja.\n\nQue carro você está procurando?")], "end_turn");
  }
  return msg([tool("buscar_estoque", { consulta: blocksText(last?.content).slice(0, 120), limite: 3 })], "tool_use");
}

function findLastVehicleId(messages: Anthropic.Beta.BetaMessageParam[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content;
    if (!Array.isArray(c)) continue;
    for (const b of c as any[]) {
      if (b.type === "tool_use" && b.input?.veiculo_id) return b.input.veiculo_id;
    }
  }
  return null;
}
