import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { coreLog } from "./logger.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export function getRepoRoot(): string {
  return process.env.GIT_REPO_PATH?.trim() || repoRoot;
}

/** True when this process was started by PM2. */
export function isPm2Managed(): boolean {
  return process.env.pm_id !== undefined;
}

export function restartProcess(): never {
  if (isPm2Managed()) {
    coreLog.info("Exiting for PM2 restart");
    process.exit(0);
  }

  coreLog.info("Spawning detached process restart");
  const child = spawn(process.execPath, process.argv.slice(1), {
    cwd: process.cwd(),
    detached: true,
    stdio: "inherit",
    env: process.env,
  });
  child.unref();
  process.exit(0);
}
