import { PermissionFlagsBits, type CommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { GuardFunction } from "discordx";

import { getModuleContext } from "./module-loader.js";

export const AllowedGuildOnly: GuardFunction<CommandInteraction> = async (
  interaction,
  _client,
  next,
) => {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { config } = getModuleContext();
  if (interaction.guildId !== config.discordGuildId) {
    await interaction.reply({
      content: "This bot is not configured for this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await next();
};

export const ManageGuildOnly: GuardFunction<CommandInteraction> = async (
  interaction,
  _client,
  next,
) => {
  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: "You need the **Manage Server** permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await next();
};

export const ManageRolesOnly: GuardFunction<CommandInteraction> = async (
  interaction,
  _client,
  next,
) => {
  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)
  ) {
    await interaction.reply({
      content: "You need the **Manage Roles** permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await next();
};

export const AdministratorOnly: GuardFunction<CommandInteraction> = async (
  interaction,
  _client,
  next,
) => {
  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: "You need the **Administrator** permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await next();
};

/** Restricts powerful commands to BOT_ADMIN_USER_IDS, or Administrator if unset. */
export const BotAdminOnly: GuardFunction<CommandInteraction> = async (
  interaction,
  _client,
  next,
) => {
  const { config } = getModuleContext();
  const allowlist = config.botAdminUserIds;

  if (allowlist.length > 0) {
    if (!allowlist.includes(interaction.user.id)) {
      await interaction.reply({
        content: "You are not authorized to use this command.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await next();
    return;
  }

  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: "You need the **Administrator** permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await next();
};
