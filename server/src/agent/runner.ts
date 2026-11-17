import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { aiTurns, contacts, events, leads } from "../db/repos.js";
import { getSettings } from "../db/settings.js";
import type { Contact } from "../types.js";
import { log } from "../util/log.js";
import { deliverSequence, splitIntoBubbles } from "../pipeline/outbox.js";
import { buildSystemPrompt, buildTurnContext } from "./prompt.js";
import { runTool, toolDefinitions, type ToolContext } from "./tools.js";
import { mockRespond } from "./mock.js";

let client: Anthropic | null = null;
export const anthropic = () => (client ??= new Anthropic({ maxRetries: 3, timeout: 120_000 }));

type Param = Anthropic.Beta.BetaMessageParam;
type UserBlock = Anthropic.Beta.BetaContentBlockParam;

/** Mensagem de sistema no meio da conversa (suportada pelo Claude Opus 5.5). */
type SystemTurn = { role: "system"; content: string };
type Turn = Param | SystemTurn;

const NO_REPLY = "[SEM_RESPOSTA]";

export class ModelUnavailableError extends Error {}

async function callModel(system: string, tools: Anthropic.Beta.BetaTool[], messages: Turn[]): Promise<Anthropic.Beta.BetaMessage> {
  if (config.ai.provider === "mock") return mockRespond(messages as any, system);

  const betas: Anthropic.Beta.AnthropicBeta[] = [];
  if (config.ai.serverFallback) betas.push("server-side-fallback-2026-07-01");

  try {
    return await anthropic().beta.messages.create({
      model: config.ai.model,
      max_tokens: 16000,
      // thinking adaptativo é sempre ligado no Opus 5.5; o esforço controla profundidade e latência
      thinking: { type: "adaptive" },
      output_config: { effort: config.ai.effort },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } }],
      tools,
      tool_choice: { type: "auto" },
      // cache automático do histórico da conversa (prefixo só cresce, então reaproveita)
      cache_control: { type: "ephemeral" },
      messages: messages as Param[],
      ...(betas.length ? { betas } : {}),
      ...(config.ai.serverFallback ? { fallbacks: "default" as const } : {}),
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new ModelUnavailableError("limite de uso da API atingido");
    if (e instanceof Anthropic.AuthenticationError) throw new ModelUnavailableError("chave da API inválida");
    if (e instanceof Anthropic.BadRequestError) {
      log.error("requisição recusada pela API", { err: e.message });
      throw e;
    }
    if (e instanceof Anthropic.APIError) throw new ModelUnavailableError(`API indisponível (${e.status})`);
    if (e instanceof Anthropic.APIConnectionError) throw new ModelUnavailableError("sem conexão com a API");
    throw e;
  }
}

export interface TurnResult {
  sent: number;
  handedOff: boolean;
  rounds: number;
  model: string | null;
}

/**
 * Roda um turno do agente para um contato.
 * O histórico é só de acréscimo (append-only): nada já enviado ao modelo é editado,
 * o que mantém o cache e os blocos de raciocínio válidos.
 */
export async function runAgentTurn(
  contactId: number,
  userBlocks: UserBlock[],
  opts: { extraContext?: string[]; onCommit?: () => void } = {},
): Promise<TurnResult> {
  let contact = contacts.get(contactId) as Contact;
  const storeId = contact.store_id;
  const settings = getSettings(storeId);
  const lead = leads.get(contactId)!;
  const session = aiTurns.currentSession(contactId);
  const history = aiTurns.history(session.id) as Turn[];
  const system = buildSystemPrompt(storeId, settings);
  const tools = toolDefinitions(settings);
  const context = buildTurnContext(settings, contact, lead, { isNewSession: session.isNew || history.length === 0, extra: opts.extraContext });

  const ctx: ToolContext = { contact, storeId, settings, signals: {}, sent: 0, handedOff: false };
  const pendingUser: Turn[] = [
    { role: "user", content: userBlocks },
    { role: "system", content: context },
  ];
  let committed = false;
  let rounds = 0;
  let lastModel: string | null = null;

  const commitPending = () => {
    if (committed) return;
    for (const t of pendingUser) aiTurns.append(contactId, session.id, t.role as any, t.content);
    committed = true;
    opts.onCommit?.();
  };
  const commitUserOnly = () => {
    if (committed) return;
    aiTurns.append(contactId, session.id, "user", userBlocks);
    committed = true;
    opts.onCommit?.();
  };

  const working: Turn[] = [...history, ...pendingUser];

  while (rounds < config.ai.maxToolRounds) {
    rounds++;
    const resp = await callModel(system, tools, working);
    lastModel = resp.model;
    aiTurns.addUsage(session.id, {
      input: resp.usage?.input_tokens ?? 0,
      output: resp.usage?.output_tokens ?? 0,
      cacheRead: resp.usage?.cache_read_input_tokens ?? 0,
    });
    if (resp.model && config.ai.provider !== "mock" && resp.model !== config.ai.model) {
      log.info("resposta servida por modelo de fallback", { contactId, model: resp.model });
    }

    if (resp.stop_reason === "refusal") {
      // não guarda a resposta recusada; guarda só o que o cliente disse
      commitUserOnly();
      events.add(storeId, contactId, "ia_recusou", { categoria: (resp as any).stop_details?.category ?? null });
      log.warn("modelo recusou o turno", { contactId, details: (resp as any).stop_details });
      const { handoff } = await import("../services/handoff.js");
      await deliverSequence(contact, [{ type: "text", body: "Vou pedir para um dos nossos consultores te responder sobre isso, tá bom? Só um instante 🙂" }]);
      await handoff(contact, "duvida_sem_resposta", "A IA não conseguiu responder a última mensagem. Verifique a conversa.", false);
      return { sent: ctx.sent + 1, handedOff: true, rounds, model: lastModel };
    }

    const toolUses = resp.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

    if (resp.stop_reason === "max_tokens" && toolUses.length) {
      // chamada de ferramenta cortada no meio: não executa
      commitUserOnly();
      log.warn("resposta cortada por max_tokens", { contactId });
      break;
    }

    commitPending();
    aiTurns.append(contactId, session.id, "assistant", resp.content);
    working.push({ role: "assistant", content: resp.content as any });

    const text = resp.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim();

    contact = contacts.get(contactId)!;
    ctx.contact = contact;
    if (text && !text.includes(NO_REPLY)) {
      const rows = await deliverSequence(contact, splitIntoBubbles(text).map((body) => ({ type: "text" as const, body })));
      ctx.sent += rows.length;
    }

    if (resp.stop_reason === "tool_use" && toolUses.length) {
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      // em sequência: várias ferramentas mandam mensagens e a ordem importa para o cliente
      for (const tu of toolUses) {
        const r = await runTool(tu.name, tu.input, ctx);
        log.debug("ferramenta", { contactId, tool: tu.name, isError: r.isError });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      }
      const toolTurn: Param = { role: "user", content: results };
      aiTurns.append(contactId, session.id, "user", results);
      working.push(toolTurn);
      continue;
    }

    if (resp.stop_reason === "pause_turn") continue;
    break;
  }

  if (!committed) commitUserOnly();
  return { sent: ctx.sent, handedOff: ctx.handedOff, rounds, model: lastModel };
}
