import {
  ApplicationCommandOptionType,
  ChannelType,
  type CommandInteraction,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  MessageFlags,
  type Role,
} from "discord.js";
import {
  Discord,
  Guard,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";

import { AllowedGuildOnly, ManageRolesOnly } from "../../core/guards.js";
import { getModuleContext } from "../../core/module-loader.js";
import { bot } from "../../core/bot.js";
import {
  addRoleRequestPanelRole,
  getRoleRequestPanel,
  getRoleRequestPanelRoles,
  removeRoleRequestPanelRole,
  updateRoleRequestPanelRole,
  upsertRoleRequestPanel,
  type RolePaneConfig,
} from "./database.js";
import { parseEmbedColor, validateImageUrl } from "./pane-style.js";
import { refreshRoleRequestPanel } from "./panel.js";

/** Treat omitted or blank slash-command strings as "not provided". */
function optionalProvidedString(
  value: string | null | undefined,
): string | undefined {
  if (value == null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildRolePaneEditsFromInteraction(
  interaction: ChatInputCommandInteraction,
  role: Role,
): { edits: RolePaneConfig; errors: string[] } {
  const edits: RolePaneConfig = {};
  const errors: string[] = [];

  const applyString = (
    optionName: string,
    apply: (value: string) => void,
  ): void => {
    const raw = interaction.options.getString(optionName);
    if (raw === null) {
      return;
    }

    const value = optionalProvidedString(raw);
    if (value !== undefined) {
      apply(value);
    }
  };

  applyString("label", (value) => {
    edits.buttonLabel = value;
  });

  applyString("description", (value) => {
    edits.description = value;
  });

  applyString("image", (value) => {
    try {
      edits.imageUrl = validateImageUrl(value);
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Invalid image URL.",
      );
    }
  });

  applyString("color", (value) => {
    try {
      edits.color = parseEmbedColor(value, role.color);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid color.");
    }
  });

  return { edits, errors };
}

function rolePaneOptions(
  role: Role,
  options: {
    label?: string | null;
    description?: string | null;
    image?: string | null;
    color?: string | null;
  },
) {
  const image = optionalProvidedString(options.image);
  const color = optionalProvidedString(options.color);

  return {
    buttonLabel: optionalProvidedString(options.label),
    description: optionalProvidedString(options.description) ?? null,
    imageUrl: image ? validateImageUrl(image) : null,
    color: color ? parseEmbedColor(color, role.color) : null,
  };
}

async function refreshPanelOrReply(
  interaction: CommandInteraction,
  guild: NonNullable<CommandInteraction["guild"]>,
  successMessage: string,
): Promise<void> {
  const { db } = getModuleContext();
  const panel = getRoleRequestPanel(db, guild.id);

  if (!panel) {
    await interaction.editReply({ content: successMessage });
    return;
  }

  try {
    await refreshRoleRequestPanel(db, bot, guild);
    await interaction.editReply({ content: successMessage });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update role panel.";
    await interaction.editReply({ content: `Error: ${message}` });
  }
}

@Discord()
@SlashGroup({ description: "Self-assignable role panels", name: "roles" })
@Guard(AllowedGuildOnly, ManageRolesOnly)
export class RoleRequestCommands {
  @Slash({
    description: "Set the channel for the role request panel and post it",
    name: "setup",
  })
  @SlashGroup("roles")
  async setup(
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Channel where the role panel will be posted",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    channel: GuildTextBasedChannel,
    @SlashOption({
      description: "Title shown on the role panel embed",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    title: string | undefined,
    @SlashOption({
      description: "Description shown on the role panel embed",
      name: "description",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    description: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const guild = interaction.guild!;

    upsertRoleRequestPanel(db, {
      guildId: guild.id,
      channelId: channel.id,
      title,
      description,
    });

    const roles = getRoleRequestPanelRoles(db, guild.id);
    if (roles.length === 0) {
      await interaction.editReply({
        content: [
          `Role request channel set to ${channel}.`,
          "Add roles with `/roles add`, then run `/roles refresh` to post the panel.",
        ].join("\n"),
      });
      return;
    }

    await refreshPanelOrReply(
      interaction,
      guild,
      `Role request panel posted in ${channel}.`,
    );
  }

  @Slash({
    description: "Add a role pane and button to the role request panel",
    name: "add",
  })
  @SlashGroup("roles")
  async add(
    @SlashOption({
      description: "Role users can toggle on/off",
      name: "role",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role,
    @SlashOption({
      description: "Custom button label (defaults to role name)",
      name: "label",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    label: string | undefined,
    @SlashOption({
      description: "Description shown in this role's pane",
      name: "description",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    description: string | undefined,
    @SlashOption({
      description: "Image URL shown as a small icon beside the role name",
      name: "image",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    image: string | undefined,
    @SlashOption({
      description: "Pane color as hex, e.g. #5865F2 (defaults to role color)",
      name: "color",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    color: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const guild = interaction.guild!;

    if (role.managed) {
      await interaction.editReply({
        content: "Integration-managed roles can't be added to the panel.",
      });
      return;
    }

    try {
      addRoleRequestPanelRole(
        db,
        guild.id,
        role.id,
        rolePaneOptions(role, { label, description, image, color }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid role pane options.";
      await interaction.editReply({ content: `Error: ${message}` });
      return;
    }

    const panel = getRoleRequestPanel(db, guild.id);
    if (!panel) {
      await interaction.editReply({
        content: [
          `Added **${role.name}** to the panel configuration.`,
          "Run `/roles setup` to choose a channel and post the panel.",
        ].join("\n"),
      });
      return;
    }

    await refreshPanelOrReply(
      interaction,
      guild,
      `Added **${role.name}** and updated the panel in <#${panel.channel_id}>.`,
    );
  }

  @Slash({
    description: "Edit a role pane's description, image, color, or button label",
    name: "edit",
  })
  @SlashGroup("roles")
  async edit(
    @SlashOption({
      description: "Role to edit on the panel",
      name: "role",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role,
    @SlashOption({
      description: "New button label",
      name: "label",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    _label: string | undefined,
    @SlashOption({
      description: "New pane description",
      name: "description",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    _description: string | undefined,
    @SlashOption({
      description: "New small icon image URL (shown beside role name)",
      name: "image",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    _image: string | undefined,
    @SlashOption({
      description: "New pane color as hex, e.g. #5865F2",
      name: "color",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    _color: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.isChatInputCommand()) {
      await interaction.editReply({ content: "Unsupported interaction type." });
      return;
    }

    const { db } = getModuleContext();
    const guild = interaction.guild!;

    const { edits, errors } = buildRolePaneEditsFromInteraction(
      interaction,
      role,
    );

    if (errors.length > 0) {
      await interaction.editReply({
        content: `Error: ${errors.join(" ")}`,
      });
      return;
    }

    if (Object.keys(edits).length === 0) {
      await interaction.editReply({
        content: "Provide at least one field to update.",
      });
      return;
    }

    try {
      const updated = updateRoleRequestPanelRole(
        db,
        guild.id,
        role.id,
        edits,
      );

      if (!updated) {
        await interaction.editReply({
          content: `**${role.name}** is not on the role panel. Add it with \`/roles add\`.`,
        });
        return;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update role.";
      await interaction.editReply({ content: `Error: ${message}` });
      return;
    }

    await refreshPanelOrReply(
      interaction,
      guild,
      `Updated **${role.name}** and refreshed the panel.`,
    );
  }

  @Slash({
    description: "Remove a role button from the role request panel",
    name: "remove",
  })
  @SlashGroup("roles")
  async remove(
    @SlashOption({
      description: "Role to remove from the panel",
      name: "role",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const guild = interaction.guild!;
    const removed = removeRoleRequestPanelRole(db, guild.id, role.id);

    if (!removed) {
      await interaction.editReply({
        content: `**${role.name}** is not on the role panel.`,
      });
      return;
    }

    const panel = getRoleRequestPanel(db, guild.id);
    if (!panel) {
      await interaction.editReply({
        content: `Removed **${role.name}** from the panel configuration.`,
      });
      return;
    }

    const remaining = getRoleRequestPanelRoles(db, guild.id);
    if (remaining.length === 0) {
      await interaction.editReply({
        content: `Removed **${role.name}**. Add roles and run \`/roles refresh\` to repost the panel.`,
      });
      return;
    }

    await refreshPanelOrReply(
      interaction,
      guild,
      `Removed **${role.name}** and updated the panel.`,
    );
  }

  @Slash({
    description: "Repost or update the role request panel message",
    name: "refresh",
  })
  @SlashGroup("roles")
  async refresh(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const guild = interaction.guild!;

    try {
      await refreshRoleRequestPanel(db, bot, guild);
      const panel = getRoleRequestPanel(db, guild.id);
      await interaction.editReply({
        content: panel
          ? `Role panel updated in <#${panel.channel_id}>.`
          : "Role panel updated.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to refresh role panel.";
      await interaction.editReply({ content: `Error: ${message}` });
    }
  }

  @Slash({
    description: "Show the configured role request panel",
    name: "list",
  })
  @SlashGroup("roles")
  async list(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const guild = interaction.guild!;
    const panel = getRoleRequestPanel(db, guild.id);

    if (!panel) {
      await interaction.editReply({
        content: "No role panel configured. Use `/roles setup` to get started.",
      });
      return;
    }

    const roles = getRoleRequestPanelRoles(db, guild.id);
    const roleLines =
      roles.length === 0
        ? ["No roles configured yet. Use `/roles add`."]
        : roles.map((entry) => {
            const role = guild.roles.cache.get(entry.role_id);
            const name = role?.name ?? entry.role_id;
            const label = entry.button_label ? ` [${entry.button_label}]` : "";
            const desc = entry.description
              ? `\n  ${entry.description}`
              : "\n  _No description_";
            const image = entry.image_url ? `\n  Image: ${entry.image_url}` : "";
            const color = entry.color != null ? `\n  Color: #${entry.color.toString(16).padStart(6, "0")}` : "";
            return `• **${name}**${label}${desc}${image}${color}`;
          });

    await interaction.editReply({
      content: [
        `**Role panel**`,
        `Channel: <#${panel.channel_id}>`,
        panel.message_id ? `Message ID: \`${panel.message_id}\`` : "Message: not posted yet",
        `Title: ${panel.title}`,
        panel.description ? `Description: ${panel.description}` : null,
        "",
        `**Roles (${roles.length})**`,
        ...roleLines,
      ]
        .filter((line) => line !== null)
        .join("\n"),
    });
  }
}
