import type { AuditLogListener } from "./listeners.js";

let listener: AuditLogListener | null = null;

export function getAuditLogListener(): AuditLogListener | null {
  return listener;
}

export function setAuditLogListener(value: AuditLogListener | null): void {
  listener = value;
}
