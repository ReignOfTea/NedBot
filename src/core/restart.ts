import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export function getRepoRoot(): string {
  return process.env.GIT_REPO_PATH?.trim() || repoRoot;
}

export function restartProcess(): never {
  const child = spawn(process.execPath, process.argv.slice(1), {
    cwd: process.cwd(),
    detached: true,
    stdio: "inherit",
    env: process.env,
  });
  child.unref();
  process.exit(0);
}
