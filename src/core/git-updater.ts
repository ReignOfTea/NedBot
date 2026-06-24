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

    try {
      if (!(await isGitRepository())) {
        coreLog.warn("Git auto-update skipped — not a git repository");
        return false;
      }

      await runCommand("git", [
        "fetch",
        this.config.gitRemote,
        this.config.gitBranch,
      ]);

      const behind = await commitsBehind(
        `${this.config.gitRemote}/${this.config.gitBranch}`,
      );
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

      await runCommand("git", [
        "pull",
        "--ff-only",
        this.config.gitRemote,
        this.config.gitBranch,
      ]);

      await runCommand("npm", ["install"]);
      await runCommand("npm", ["run", "build"]);

      coreLog.info("Update complete, restarting bot");
      restartProcess();
    } catch (error) {
      this.updating = false;
      coreLog.error({ err: error }, "Git auto-update failed");
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

function runCommand(
  command: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: getRepoRoot(),
      shell: process.platform === "win32",
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
