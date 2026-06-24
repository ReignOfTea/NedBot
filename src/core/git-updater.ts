import { spawn } from "node:child_process";

import type { AppConfig } from "./config.js";
import { coreLog } from "./logger.js";
import { getRepoRoot, restartProcess } from "./restart.js";

export interface GitUpdaterOptions {
  onBeforeRestart: () => Promise<void>;
}

export class GitUpdater {
  private interval: ReturnType<typeof setInterval> | null = null;
  private updating = false;

  constructor(
    private readonly config: AppConfig,
    private readonly options: GitUpdaterOptions,
  ) {}

  start(): void {
    if (!this.config.gitAutoUpdateEnabled) {
      return;
    }

    coreLog.info(
      {
        branch: this.config.gitBranch,
        remote: this.config.gitRemote,
        intervalSeconds: this.config.gitAutoUpdateIntervalMs / 1000,
        repoPath: getRepoRoot(),
      },
      "Git auto-update enabled",
    );

    void this.checkForUpdates();
    this.interval = setInterval(
      () => void this.checkForUpdates(),
      this.config.gitAutoUpdateIntervalMs,
    );
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async checkForUpdates(): Promise<boolean> {
    if (this.updating) {
      return false;
    }

    const remoteRef = `${this.config.gitRemote}/${this.config.gitBranch}`;

    try {
      if (!(await isGitRepository())) {
        coreLog.warn("Git auto-update skipped — not a git repository");
        return false;
      }

      await runGitStep("fetch", () =>
        runCommand("git", [
          "fetch",
          "--prune",
          this.config.gitRemote,
          `refs/heads/${this.config.gitBranch}:refs/remotes/${remoteRef}`,
        ]),
      );

      const behind = await runGitStep("check", () => commitsBehind(remoteRef));
      if (behind === 0) {
        coreLog.debug("Git auto-update — already up to date");
        return false;
      }

      this.updating = true;
      coreLog.info(
        { behind, branch: this.config.gitBranch },
        "New commits detected, pulling and restarting",
      );

      await this.options.onBeforeRestart();

      await runGitStep("pull", () =>
        runCommand("git", [
          "pull",
          "--ff-only",
          this.config.gitRemote,
          this.config.gitBranch,
        ]),
      );

      await runGitStep("npm install", () => runCommand(npmCommand(), ["install"]));
      await runGitStep("npm build", () =>
        runCommand(npmCommand(), ["run", "build"]),
      );

      coreLog.info("Update complete, restarting bot");
      restartProcess();
    } catch (error) {
      this.updating = false;
      const detail = formatCommandError(error);
      coreLog.error({ err: error }, `Git auto-update failed: ${detail}`);
      return false;
    }

    return true;
  }
}

async function isGitRepository(): Promise<boolean> {
  try {
    await runCommand("git", ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

async function commitsBehind(remoteRef: string): Promise<number> {
  const { stdout } = await runCommand("git", [
    "rev-list",
    "--count",
    `HEAD..${remoteRef}`,
  ]);
  return Number(stdout.trim()) || 0;
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function runGitStep<T>(
  step: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const detail = formatCommandError(error);
    throw new Error(`${step}: ${detail}`);
  }
}

function formatCommandError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function runCommand(
  command: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: getRepoRoot(),
      shell: false,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed (${code}): ${stderr || stdout}`,
        ),
      );
    });
  });
}

export function startGitUpdater(
  config: AppConfig,
  options: GitUpdaterOptions,
): GitUpdater {
  const updater = new GitUpdater(config, options);
  updater.start();
  return updater;
}
