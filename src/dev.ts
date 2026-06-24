import "reflect-metadata";

import chokidar from "chokidar";

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

async function run(): Promise<void> {
  const config = loadConfig();
  initLogger({ isProduction: config.isProduction });
  const loadPattern = manifestImportPattern(import.meta.url);
  const watchPattern = allModuleImportPattern(import.meta.url);

  await initializeModules(loadPattern);
  bot.initEvents();
  await bot.login(config.botToken);

  const gitUpdater = startGitUpdater(config, {
    onBeforeRestart: async () => {
      await shutdownModules();
      bot.destroy();
    },
  });

  if (!config.isProduction) {
    coreLog.info("Hot reload enabled — module and command changes reload automatically");

    const watcher = chokidar.watch(watchPattern, { ignoreInitial: true });
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

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
