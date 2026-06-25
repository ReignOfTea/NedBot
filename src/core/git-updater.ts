import { spawn } from "node:child_process";

import type { AppConfig } from "./config.js";
import { bot } from "./bot.js";
import { announceInBotsChannel } from "./bots-channel.js";
import { coreLog } from "./logger.js";
import { getRepoRoot, restartProcess } from "./restart.js";

export interface GitUpdaterOptions {
  /** Called before pull/install when an update is about to start. */
  onPrepareForUpdate?: () => Promise<void>;
  onBeforeRestart: () => Promise<void>;
}

export class GitUpdater {
  private interval: ReturnType<typeof setInterval> | null = null;
  private updating = false;
  private checkInProgress = false;
  private exiting = false;

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
    if (this.updating || this.checkInProgress || this.exiting) {
      return false;
    }

    this.checkInProgress = true;
    const remoteRef = `${this.config.gitRemote}/${this.config.gitBranch}`;
    let shutdownCompleted = false;

    try {
      if (!(await isGitRepository())) {
        coreLog.warn("Git auto-update skipped — not a git repository");
        return false;
      }

      await runGitStep(
        "fetch",
        () =>
          runCommand("git", [
            "fetch",
            "--prune",
            this.config.gitRemote,
            `refs/heads/${this.config.gitBranch}:refs/remotes/${remoteRef}`,
          ]),
        { quiet: true },
      );

      const behind = await runGitStep("check", () => commitsBehind(remoteRef), {
        quiet: true,
      });
      if (behind === 0) {
        coreLog.debug("Git auto-update — already up to date");
        return false;
      }

      this.updating = true;
      const fromSha = await gitShortRef("HEAD");
      const toSha = await gitShortRef(remoteRef);
      coreLog.info(
        `Git auto-update: ${behind} new commit(s) on ${this.config.gitBranch} (${fromSha} → ${toSha})`,
      );

      await announceInBotsChannel(
        bot,
        this.config.discordGuildId,
        this.config.botsChannelId,
        `Ned bot is updating (${behind} commit(s): \`${fromSha}\` → \`${toSha}\`)…`,
      );

      await logDirtyWorkingTree();

      await this.options.onPrepareForUpdate?.();

      await runGitStep(
        "pull",
        () =>
          runCommand("git", [
            "pull",
            "--ff-only",
            this.config.gitRemote,
            this.config.gitBranch,
          ]),
        { summarize: summarizeGitPull },
      );

      await runGitStep("shutdown", async () => {
        await this.options.onBeforeRestart();
        shutdownCompleted = true;
      });

      await runGitStep("npm install", () =>
        runNpmCommand(["install", "--include=dev"]),
      );
      await runGitStep("npm build", () => runNpmCommand(["run", "build"]));

      coreLog.info("Git auto-update: restart starting");
      this.exiting = true;
      restartProcess();
    } catch (error) {
      this.updating = false;
      const detail = formatCommandError(error);
      coreLog.error(`Git auto-update failed — ${detail}`);

      if (shutdownCompleted && !this.exiting) {
        coreLog.warn(
          "Git auto-update: bot was shut down before failure — restarting to recover",
        );
        this.exiting = true;
        restartProcess();
      }

      return false;
    } finally {
      if (!this.updating) {
        this.checkInProgress = false;
      }
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

async function gitShortRef(ref: string): Promise<string> {
  const { stdout } = await runCommand("git", ["rev-parse", "--short", ref]);
  return stdout.trim();
}

async function logDirtyWorkingTree(): Promise<void> {
  const { stdout } = await runCommand("git", [
    "status",
    "--porcelain",
  ], { allowFailure: true });

  const dirty = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (dirty.length === 0) {
    return;
  }

  const preview = dirty.slice(0, 5).join("; ");
  const suffix = dirty.length > 5 ? ` (+${dirty.length - 5} more)` : "";
  coreLog.warn(
    `Git auto-update: working tree has local changes — pull may fail (${preview}${suffix})`,
  );
}

function summarizeGitPull(result: {
  stdout: string;
  stderr: string;
}): string | undefined {
  const line = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0);

  return line?.slice(0, 200);
}

function runNpmCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
  // npm on Windows is a .cmd shim; spawn requires shell: true (EINVAL otherwise).
  return runCommand("npm", args, { shell: process.platform === "win32" });
}

function runCommand(
  command: string,
  args: string[],
  options: { allowFailure?: boolean; shell?: boolean } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: getRepoRoot(),
      shell: options.shell ?? false,
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

async function runGitStep<T>(
  step: string,
  action: () => Promise<T>,
  options: {
    quiet?: boolean;
    summarize?: (result: T) => string | undefined;
  } = {},
): Promise<T> {
  const started = Date.now();

  if (!options.quiet) {
    coreLog.info(`Git auto-update: ${step}…`);
  }

  try {
    const result = await action();
    const durationMs = Date.now() - started;

    if (options.quiet) {
      coreLog.debug(
        `Git auto-update: ${step} complete (${formatDuration(durationMs)})`,
      );
      return result;
    }

    const summary = options.summarize?.(result);
    const suffix = summary ? ` — ${summary}` : "";
    coreLog.info(
      `Git auto-update: ${step} complete (${formatDuration(durationMs)})${suffix}`,
    );
    return result;
  } catch (error) {
    const durationMs = Date.now() - started;
    const detail = formatCommandError(error);
    throw new Error(
      `${step} failed after ${formatDuration(durationMs)}: ${detail}`,
    );
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatCommandError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function startGitUpdater(
  config: AppConfig,
  options: GitUpdaterOptions,
): GitUpdater {
  const updater = new GitUpdater(config, options);
  updater.start();
  return updater;
}
