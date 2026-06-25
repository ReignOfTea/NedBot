import { coreLog } from "./logger.js";
import { restartProcess } from "./restart.js";

const shutdownHandlers: Array<() => void | Promise<void>> = [];

export function registerShutdownHandler(
  handler: () => void | Promise<void>,
): void {
  shutdownHandlers.push(handler);
}

export async function gracefulShutdown(): Promise<void> {
  for (const handler of [...shutdownHandlers].reverse()) {
    await handler();
  }
}

export async function requestRestart(trigger?: string): Promise<never> {
  coreLog.info({ trigger }, "Restart requested");
  await gracefulShutdown();
  restartProcess();
}
