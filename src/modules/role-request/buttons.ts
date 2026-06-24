import {
  type ButtonInteraction,
  type GuildMember,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { ButtonComponent, Discord } from "discordx";

import { getModuleContext } from "../../core/module-loader.js";
import {
  getRoleRequestPanelRoles,
  parseRoleToggleCustomId,
} from "./database.js";

@Discord()
export class RoleRequestButtons {
  @ButtonComponent({ id: /^rr:toggle:\d+$/ })
  async toggleRole(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "This button can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const roleId = parseRoleToggleCustomId(interaction.customId);
    if (!roleId) {
      await interaction.reply({
        content: "Unknown role button.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { db, config } = getModuleContext();
    if (interaction.guildId !== config.discordGuildId) {
      await interaction.reply({
        content: "This bot is not configured for this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const configuredRoles = getRoleRequestPanelRoles(db, interaction.guildId);
    if (!configuredRoles.some((entry) => entry.role_id === roleId)) {
      await interaction.reply({
        content: "That role is no longer available on this panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
      await interaction.reply({
        content: "That role no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = interaction.member as GuildMember;
    const botMember = interaction.guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: "I don't have permission to manage roles.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (role.position >= botMember.roles.highest.position) {
      await interaction.reply({
        content:
          "I can't manage that role. Move my bot role above it in Server Settings.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (role.managed) {
      await interaction.reply({
        content: "That role is managed by an integration and can't be self-assigned.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const hasRole = member.roles.cache.has(roleId);

    try {
      if (hasRole) {
        await member.roles.remove(roleId);
        await interaction.reply({
          content: `Removed **${role.name}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await member.roles.add(roleId);
      await interaction.reply({
        content: `Added **${role.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update your roles.";
      await interaction.reply({
        content: `Couldn't update your roles: ${message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
