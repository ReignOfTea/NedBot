import "reflect-metadata";

import { bot } from "./core/bot.js";
import { loadConfig } from "./core/config.js";
import { coreLog, initLogger } from "./core/logger.js";
import {
  initializeModules,
  manifestImportPattern,
  shutdownModules,
} from "./core/module-loader.js";
import { startGitUpdater } from "./core/git-updater.js";

async function run(): Promise<void> {
  const config = loadConfig();
  initLogger({ isProduction: config.isProduction });
  const loadPattern = manifestImportPattern(import.meta.url);

  await initializeModules(loadPattern);
  bot.initEvents();
  await bot.login(config.botToken);

  const gitUpdater = startGitUpdater(config, {
    onBeforeRestart: async () => {
      await shutdownModules();
      bot.destroy();
    },
  });

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
