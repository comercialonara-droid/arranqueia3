import { db } from "../db/index.js";
import { appointments, contacts, followups, leads, vehicles, vehicleTitle } from "../db/repos.js";
import { getSettings } from "../db/settings.js";
import type { Contact } from "../types.js";
import { log } from "../util/log.js";
import { zonedParts, formatDateTimeBR } from "../util/time.js";
import { deliver, insideServiceWindow } from "../pipeline/outbox.js";
import { isBusy } from "../pipeline/inbox.js";
import { runAgentTurn } from "../agent/runner.js";

const firstName = (c: Contact) => (c.nome || c.nome_perfil || "").split(" ")[0] || "tudo bem";

/** Não manda mensagem automática de madrugada. */
function quietHours() {
  const h = zonedParts().hour;
  return h < 8 || h >= 21;
}

async function visitReminders() {
  const s = getSettings();
  const now = Date.now();
  const due = appointments.dueReminders(new Date(now).toISOString(), new Date(now + s.followup.lembrete_horas_antes * 3600_000).toISOString());
  for (const a of due) {
    const c = contacts.get(a.contact_id);
    if (!c) continue;
    appointments.update(a.id, { reminder_sent: true });
    const v = a.vehicle_id ? vehicles.get(a.vehicle_id) : null;
    const quando = formatDateTimeBR(new Date(a.inicio));
    if (c.channel === "simulador" || insideServiceWindow(c)) {
      await deliver(
        c,
        {
          type: "buttons",
          body: `Oi, ${firstName(c)}! Passando para lembrar da sua visita ${quando} aqui na ${s.loja.nome}${v ? ` para ver o ${vehicleTitle(v)}` : ""}. Posso confirmar? 🙂`,
          buttons: [
            { id: "visita_confirmar", title: "Confirmar" },
            { id: "visita_remarcar", title: "Remarcar" },
          ],
        },
        "ia",
        { automatico: "lembrete_visita" },
      );
    } else if (s.followup.template_lembrete_visita) {
      const t = s.followup.template_lembrete_visita;
      await deliver(c, { type: "template", name: t.nome, language: t.idioma, params: [firstName(c), quando], preview: `Lembrete de visita (${quando})` }, "ia", {
        automatico: "lembrete_visita",
      });
    }
  }
}

async function noReplyFollowups() {
  const s = getSettings();
  if (!s.followup.ativo || quietHours()) return;
  const steps = [...s.followup.horas].sort((a, b) => a - b);
  if (!steps.length) return;

  // contatos cuja última mensagem foi nossa (IA), sem resposta do cliente
  const rows = db
    .prepare(
      `SELECT c.id AS contact_id, m.id AS msg_id, m.created_at AS out_at,
        (SELECT MAX(id) FROM messages WHERE contact_id = c.id AND direction = 'in') AS last_in_id
       FROM contacts c
       JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE contact_id = c.id)
       JOIN leads l ON l.contact_id = c.id
       WHERE m.direction = 'out' AND m.sender = 'ia' AND c.opt_out = 0 AND c.channel = 'whatsapp'
         AND l.stage NOT IN ('vendido','perdido')
         AND (c.bot_paused_until IS NULL OR c.bot_paused_until < strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         AND m.created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')`,
    )
    .all() as { contact_id: number; msg_id: number; out_at: string; last_in_id: number | null }[];

  for (const r of rows) {
    if (isBusy(r.contact_id)) continue;
    const c = contacts.get(r.contact_id)!;
    const hours = (Date.now() - new Date(r.out_at).getTime()) / 3600_000;
    const step = steps.filter((h) => hours >= h).pop();
    if (step == null) continue;
    const period = String(r.last_in_id ?? 0);
    if (!followups.claim(c.id, `sem_resposta_${step}`, period)) continue;

    if (insideServiceWindow(c)) {
      try {
        await runAgentTurn(c.id, [{ type: "text", text: "[o cliente não respondeu desde a sua última mensagem]" }], {
          extraContext: [
            `Retomada automática: o cliente está sem responder há ${Math.round(hours)}h. Mande UMA mensagem curta, leve e diferente das anteriores para retomar ` +
              `(ex.: perguntar se conseguiu ver as fotos, oferecer um horário para ver o carro, avisar de uma condição). Sem pressão. ` +
              `Se não fizer sentido retomar (o cliente se despediu, disse que vai pensar agora há pouco, já está tudo resolvido), responda apenas [SEM_RESPOSTA].`,
          ],
        });
      } catch (e) {
        log.warn("follow-up com IA falhou", { contactId: c.id, err: (e as Error).message });
      }
    } else if (s.followup.template_reengajamento && followups.claim(c.id, "template_reengajamento", period)) {
      const t = s.followup.template_reengajamento;
      const lead = leads.get(c.id);
      const v = lead?.interesse[0] ? vehicles.get(lead.interesse[0]) : null;
      await deliver(
        c,
        { type: "template", name: t.nome, language: t.idioma, params: [firstName(c), v ? vehicleTitle(v) : "o carro que você viu"], preview: "Mensagem de retomada (template)" },
        "ia",
        { automatico: "reengajamento" },
      );
    }
  }
}

let running = false;
export function startScheduler() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await visitReminders();
      await noReplyFollowups();
    } catch (e) {
      log.error("erro no agendador", { err: e });
    } finally {
      running = false;
    }
  };
  const t = setInterval(tick, 60_000);
  t.unref();
  setTimeout(tick, 5_000).unref();
}
