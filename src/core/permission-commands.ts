import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  type Role,
} from "discord.js";
import {
  Discord,
  Guard,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";

import { AllowedGuildOnly } from "./guards.js";
import { DeferEphemeral, editEphemeral } from "./interactions.js";
import { getModuleContext } from "./module-loader.js";
import {
  grantRolePermission,
  isKnownPermission,
  listRolePermissions,
  listRolesWithPermission,
  OwnerOnly,
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  revokeRolePermission,
} from "./permissions/index.js";

@Discord()
@SlashGroup({ description: "Manage bot command permissions by Discord role", name: "perms" })
@Guard(AllowedGuildOnly, OwnerOnly)
export class PermissionCommands {
  @Slash({ description: "Grant a permission to a role", name: "grant" })
  @SlashGroup("perms")
  @Guard(DeferEphemeral)
  async grant(
    @SlashOption({
      description: "Discord role",
      name: "role",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role,
    @SlashOption({
      description: "Permission key (see /perms catalog)",
      name: "permission",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    permission: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    if (!isKnownPermission(permission)) {
      await editEphemeral(
        interaction,
        `Unknown permission \`${permission}\`. Use /perms catalog for valid keys.`,
      );
      return;
    }

    const { db } = getModuleContext();
    const added = grantRolePermission(
      db,
      interaction.guildId,
      role.id,
      permission,
      interaction.user.id,
    );

    await editEphemeral(
      interaction,
      added
        ? `Granted \`${permission}\` to ${role}.`
        : `${role} already has \`${permission}\`.`,
    );
  }

  @Slash({ description: "Revoke a permission from a role", name: "revoke" })
  @SlashGroup("perms")
  @Guard(DeferEphemeral)
  async revoke(
    @SlashOption({
      description: "Discord role",
      name: "role",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role,
    @SlashOption({
      description: "Permission key (see /perms catalog)",
      name: "permission",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    permission: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    if (!isKnownPermission(permission)) {
      await editEphemeral(
        interaction,
        `Unknown permission \`${permission}\`. Use /perms catalog for valid keys.`,
      );
      return;
    }

    const { db } = getModuleContext();
    const removed = revokeRolePermission(
      db,
      interaction.guildId,
      role.id,
      permission,
    );

    await editEphemeral(
      interaction,
      removed
        ? `Revoked \`${permission}\` from ${role}.`
        : `${role} did not have \`${permission}\`.`,
    );
  }

  @Slash({ description: "List permissions for a role", name: "list" })
  @SlashGroup("perms")
  @Guard(DeferEphemeral)
  async list(
    @SlashOption({
      description: "Discord role",
      name: "role",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    const { db } = getModuleContext();
    const permissions = listRolePermissions(db, interaction.guildId, role.id);

    if (permissions.length === 0) {
      await editEphemeral(interaction, `${role} has no bot permissions.`);
      return;
    }

    const lines = permissions.map((perm) => {
      const label = PERMISSION_CATALOG[perm];
      return label ? `- \`${perm}\` — ${label}` : `- \`${perm}\``;
    });

    await editEphemeral(
      interaction,
      `**${role.name}**\n${lines.join("\n")}`,
    );
  }

  @Slash({
    description: "List roles that have a permission",
    name: "roles",
  })
  @SlashGroup("perms")
  @Guard(DeferEphemeral)
  async roles(
    @SlashOption({
      description: "Permission key (see /perms catalog)",
      name: "permission",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    permission: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    if (!isKnownPermission(permission)) {
      await editEphemeral(
        interaction,
        `Unknown permission \`${permission}\`. Use /perms catalog for valid keys.`,
      );
      return;
    }

    const { db } = getModuleContext();
    const roleIds = listRolesWithPermission(
      db,
      interaction.guildId,
      permission,
    );

    if (roleIds.length === 0) {
      await editEphemeral(
        interaction,
        `No roles have \`${permission}\`.`,
      );
      return;
    }

    const mentions = roleIds.map((id) => `<@&${id}>`).join(", ");
    const label = PERMISSION_CATALOG[permission];
    const header = label
      ? `**${permission}** — ${label}`
      : `**${permission}**`;

    await editEphemeral(interaction, `${header}\n${mentions}`);
  }

  @Slash({ description: "List all permission keys", name: "catalog" })
  @SlashGroup("perms")
  @Guard(DeferEphemeral)
  async catalog(interaction: CommandInteraction): Promise<void> {
    const lines = PERMISSION_KEYS.map((key) => {
      const label = PERMISSION_CATALOG[key];
      return `- \`${key}\`${label ? ` — ${label}` : ""}`;
    });

    await editEphemeral(
      interaction,
      `**Permission catalog**\n${lines.join("\n")}`,
    );
  }
}
