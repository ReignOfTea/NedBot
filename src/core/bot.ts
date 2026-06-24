import {
  IntentsBitField,
  PermissionFlagsBits,
  type Interaction,
} from "discord.js";
import { Client } from "discordx";

import { coreLog } from "./logger.js";
import { isIgnorableInteractionError } from "./interactions.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

export const bot = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
  ],
  silent: true,
  botGuilds: [config.discordGuildId],
});

function buildInviteUrl(clientId: string): string {
  const permissions =
    PermissionFlagsBits.ViewChannel |
    PermissionFlagsBits.SendMessages |
    PermissionFlagsBits.EmbedLinks |
    PermissionFlagsBits.ManageRoles;

  const params = new URLSearchParams({
    client_id: clientId,
    permissions: permissions.toString(),
    scope: "bot applications.commands",
  });

  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

bot.once("clientReady", async () => {
  coreLog.info({ user: bot.user?.tag }, "Logged in");
  coreLog.info({ guildId: config.discordGuildId }, "Guild-only mode");

  if (bot.user) {
    coreLog.info({ url: buildInviteUrl(bot.user.id) }, "Invite link");
  }

  // Remove stale global commands so only guild-scoped commands are active.
  await bot.application?.commands.set([]);
  await bot.initApplicationCommands();
  coreLog.info(
    { guildId: config.discordGuildId },
    "Slash commands synced to guild",
  );
});

bot.on("interactionCreate", (interaction: Interaction) => {
  if (
    interaction.guildId &&
    interaction.guildId !== config.discordGuildId
  ) {
    return;
  }

  void Promise.resolve(bot.executeInteraction(interaction)).catch(
    (error: unknown) => {
    if (isIgnorableInteractionError(error)) {
      coreLog.debug("Ignored expired or duplicate interaction");
      return;
    }
    coreLog.error({ err: error }, "Interaction handler failed");
  },
  );
});
