import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { withStore } from "./api";

export type LiveEvent =
  | { type: "message"; contactId: number; messageId: number }
  | { type: "contact"; contactId: number }
  | { type: "typing"; contactId: number; on: boolean }
  | { type: "lead"; contactId: number }
  | { type: "appointment"; contactId: number; appointmentId: number };

const listeners = new Set<(e: LiveEvent) => void>();
export const onLive = (fn: (e: LiveEvent) => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** Conecta no stream do servidor e atualiza as telas quando chega mensagem, lead ou visita. */
export function useLiveUpdates(enabled: boolean, storeKey: number | null = null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(withStore("/api/stream"), { withCredentials: true });
    let timer: number | undefined;
    const pending = new Set<string>();
    const invalidate = (key: string) => {
      pending.add(key);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        for (const k of pending) qc.invalidateQueries({ queryKey: JSON.parse(k) });
        pending.clear();
      }, 250);
    };
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as LiveEvent;
      listeners.forEach((fn) => fn(e));
      if (e.type === "typing") return;
      invalidate(JSON.stringify(["conversas"]));
      invalidate(JSON.stringify(["conversa", e.contactId]));
      if (e.type === "lead" || e.type === "contact") {
        invalidate(JSON.stringify(["leads"]));
        invalidate(JSON.stringify(["simulacoes"]));
      }
      if (e.type === "appointment") invalidate(JSON.stringify(["agenda"]));
      invalidate(JSON.stringify(["stats"]));
    };
    return () => {
      es.close();
      window.clearTimeout(timer);
    };
  }, [enabled, qc, storeKey]);
}
