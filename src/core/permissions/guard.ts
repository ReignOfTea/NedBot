import { MessageFlags, type CommandInteraction } from "discord.js";
import type { GuardFunction } from "discordx";

import { getModuleContext } from "../module-loader.js";
import { editEphemeral } from "../interactions.js";
import { hasPermission } from "./check.js";
import { resolveCommandPermission } from "./registry.js";

export function requirePermission(
  permission: string,
): GuardFunction<CommandInteraction> {
  return async (interaction, _client, next) => {
    if (!hasPermission(interaction, permission)) {
      await interaction.reply({
        content: `You do not have permission \`${permission}\` for this command.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await next();
  };
}

/** Resolves the permission key from the invoked slash command (e.g. youtube.subscribe). */
export const CommandPermission: GuardFunction<CommandInteraction> = async (
  interaction,
  _client,
  next,
) => {
  if (!interaction.isChatInputCommand()) {
    await interaction.reply({
      content: "This command can only be used as a slash command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const permission = resolveCommandPermission(interaction);

  if (!hasPermission(interaction, permission)) {
    await interaction.reply({
      content: `You do not have permission \`${permission}\` for this command.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await next();
};

export const OwnerOnly: GuardFunction<CommandInteraction> = async (
  interaction,
  _client,
  next,
) => {
  const { config } = getModuleContext();

  if (!config.botOwnerUserId) {
    await editEphemeral(
      interaction,
      "BOT_OWNER_USER_ID is not configured — only the owner can manage permissions.",
    );
    return;
  }

  if (interaction.user.id !== config.botOwnerUserId) {
    await editEphemeral(
      interaction,
      "Only the bot owner can manage permissions.",
    );
    return;
  }

  await next();
};
