import "reflect-metadata";

import { bot } from "./core/bot.js";
import { loadConfig } from "./core/config.js";
import { coreLog, initLogger } from "./core/logger.js";
import {
  initializeModules,
  manifestImportPattern,
  shutdownModules,
} from "./core/module-loader.js";

async function run(): Promise<void> {
  const config = loadConfig();
  initLogger({ isProduction: config.isProduction });
  const loadPattern = manifestImportPattern(import.meta.url);

  await initializeModules(loadPattern);
  bot.initEvents();
  await bot.login(config.botToken);

  await bot.application?.commands.set([]);
  await bot.initApplicationCommands();

  const guildCommands = await bot.application?.commands.fetch({
    guildId: config.discordGuildId,
  });
  const commandNames = [...(guildCommands?.values() ?? [])]
    .map((command) => command.name)
    .sort();

  coreLog.info(
    `Synced slash commands to guild ${config.discordGuildId}: ${commandNames.join(", ")}`,
  );

  await shutdownModules();
  bot.destroy();
}

run().catch((error: unknown) => {
  try {
    coreLog.fatal({ err: error }, "Command sync failed");
  } catch {
    console.error("Command sync failed:", error);
  }
  process.exit(1);
});
