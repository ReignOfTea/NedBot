import type { XPushListener } from "./push-client.js";

let listener: XPushListener | null = null;

export function setXPushListener(instance: XPushListener | null): void {
  listener = instance;
}

export function getXPushListener(): XPushListener | null {
  return listener;
}
