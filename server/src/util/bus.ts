import { EventEmitter } from "node:events";

/** Barramento interno para atualizar o painel em tempo real (via SSE). */
export const bus = new EventEmitter();
bus.setMaxListeners(200);

export type BusEvent =
  | { type: "message"; contactId: number; messageId: number }
  | { type: "contact"; contactId: number }
  | { type: "typing"; contactId: number; on: boolean }
  | { type: "lead"; contactId: number }
  | { type: "appointment"; contactId: number; appointmentId: number };

export const publish = (e: BusEvent) => bus.emit("event", e);
