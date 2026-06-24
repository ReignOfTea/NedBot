import {
  ActionRowBuilder,
  ButtonBuilder,
  type APIEmbed,
  type Client,
  type Guild,
  type TextChannel,
} from "discord.js";

import type { Database } from "../../core/database.js";
import {
  getRoleRequestPanel,
  getRoleRequestPanelRoles,
  roleToggleCustomId,
  setRoleRequestPanelMessageId,
  type RoleRequestPanelRoleRow,
} from "./database.js";
import { resolveEmbedColor, colorToButtonStyle } from "./pane-style.js";

const MAX_BUTTONS = 25;
const MAX_ROLE_PANES = 9;

export async function refreshRoleRequestPanel(
  db: Database,
  client: Client,
  guild: Guild,
): Promise<string> {
  const panel = getRoleRequestPanel(db, guild.id);
  if (!panel) {
    throw new Error("No role request panel configured. Use `/roles setup` first.");
  }

  const roles = getRoleRequestPanelRoles(db, guild.id);
  if (roles.length === 0) {
    throw new Error("No roles configured. Add roles with `/roles add`.");
  }

  if (roles.length > MAX_BUTTONS) {
    throw new Error(`A panel supports at most ${MAX_BUTTONS} roles.`);
  }

  const channel = await client.channels.fetch(panel.channel_id);
  if (!channel?.isTextBased()) {
    throw new Error("The configured role request channel is unavailable.");
  }

  const textChannel = channel as TextChannel;
  const components = buildRoleButtonRows(guild, roles);
  const embeds = buildRolePanelEmbeds(guild, panel, roles);
  const payload = { embeds, components };

  if (panel.message_id) {
    const existing = await textChannel.messages
      .fetch(panel.message_id)
      .catch(() => null);

    if (existing) {
      await existing.edit(payload);
      setRoleRequestPanelMessageId(db, guild.id, existing.id);
      return existing.id;
    }
  }

  const message = await textChannel.send(payload);
  setRoleRequestPanelMessageId(db, guild.id, message.id);
  return message.id;
}

function buildRolePanelEmbeds(
  guild: Guild,
  panel: { title: string; description: string | null },
  panelRoles: RoleRequestPanelRoleRow[],
): APIEmbed[] {
  const paneRoles = panelRoles.slice(0, MAX_ROLE_PANES);
  const overflowCount = panelRoles.length - paneRoles.length;

  let introDescription =
    panel.description ??
    "Click the matching button below to add or remove a role from yourself.";

  if (overflowCount > 0) {
    introDescription += `\n\n*${overflowCount} more role(s) are available via buttons below without a preview pane (Discord allows up to ${MAX_ROLE_PANES} role previews per message).*`;
  }

  const embeds: APIEmbed[] = [
    {
      title: panel.title,
      description: introDescription,
      color: 0x5865f2,
    },
  ];

  for (const panelRole of paneRoles) {
    const role = guild.roles.cache.get(panelRole.role_id);
    if (!role) {
      continue;
    }

    const description =
      panelRole.description?.trim() ||
      "No description provided. Use `/roles edit` to add one.";

    const embed: APIEmbed = {
      color: resolveEmbedColor(panelRole.color, role.color),
      description,
    };

    if (panelRole.image_url) {
      // Author icons render small (~32px) to the left of the role name.
      embed.author = {
        name: role.name,
        icon_url: panelRole.image_url,
      };
    } else {
      embed.title = role.name;
    }

    embeds.push(embed);
  }

  return embeds;
}

function buildRoleButtonRows(
  guild: Guild,
  panelRoles: RoleRequestPanelRoleRow[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  for (const panelRole of panelRoles) {
    const role = guild.roles.cache.get(panelRole.role_id);
    if (!role) {
      continue;
    }

    const embedColor = resolveEmbedColor(panelRole.color, role.color);

    const button = new ButtonBuilder()
      .setCustomId(roleToggleCustomId(role.id))
      .setLabel(truncate(panelRole.button_label ?? role.name, 80))
      .setStyle(colorToButtonStyle(embedColor));

    currentRow.addComponents(button);

    if (currentRow.components.length === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    throw new Error("None of the configured roles exist in this server.");
  }

  return rows;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
