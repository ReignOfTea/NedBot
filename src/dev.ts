import "reflect-metadata";

import chokidar, { type FSWatcher } from "chokidar";

import { bot } from "./core/bot.js";
import { loadConfig } from "./core/config.js";
import { coreLog, initLogger } from "./core/logger.js";
import {
  allModuleImportPattern,
  initializeModules,
  manifestImportPattern,
  reloadModules,
  shutdownModules,
} from "./core/module-loader.js";
import { startGitUpdater } from "./core/git-updater.js";
import { setGitUpdater } from "./core/git-updater-runtime.js";

async function run(): Promise<void> {
  const config = loadConfig();
  initLogger({ isProduction: config.isProduction });
  const loadPattern = manifestImportPattern(import.meta.url);
  const watchPattern = allModuleImportPattern(import.meta.url);

  await initializeModules(loadPattern);
  bot.initEvents();
  await bot.login(config.botToken);

  let watcher: FSWatcher | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  const gitUpdater = startGitUpdater(config, {
    onPrepareForUpdate: async () => {
      gitUpdater.stop();

      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }

      if (watcher) {
        await watcher.close();
        watcher = null;
        coreLog.info("Git auto-update: hot reload paused for update");
      }
    },
    onBeforeRestart: async () => {
      await shutdownModules();
      bot.destroy();
    },
  });
  setGitUpdater(gitUpdater);

  if (!config.isProduction) {
    coreLog.info("Hot reload enabled — module and command changes reload automatically");

    watcher = chokidar.watch(watchPattern, { ignoreInitial: true });

    const scheduleReload = () => {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void reloadModules(loadPattern).catch((error: unknown) => {
          coreLog.error({ err: error }, "Module reload failed");
        });
      }, 300);
    };

    watcher.on("add", scheduleReload);
    watcher.on("change", scheduleReload);
    watcher.on("unlink", scheduleReload);
  }

  const shutdown = async (signal: string) => {
    coreLog.info({ signal }, "Shutting down");
    gitUpdater.stop();

    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }

    if (watcher) {
      await watcher.close();
    }

    await shutdownModules();
    bot.destroy();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

run().catch((error: unknown) => {
  try {
    coreLog.fatal({ err: error }, "Fatal error");
  } catch {
    console.error("Fatal error:", error);
  }
  process.exit(1);
});
