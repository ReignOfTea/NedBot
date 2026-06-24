import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
} from "discord.js";

import type { XPostAlert } from "./types.js";

export function buildXAlertPayload(alert: XPostAlert): {
  embed: APIEmbed;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed: APIEmbed = {
    title: `𝕏 @${alert.username} posted`,
    description: alert.body || "New post",
    url: alert.url,
    color: 0x1d9bf0,
    thumbnail: alert.iconUrl ? { url: alert.iconUrl } : undefined,
    footer: { text: "X Post Alert" },
  };

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("View Post")
      .setStyle(ButtonStyle.Link)
      .setURL(alert.url),
  );

  return { embed, components: [row] };
}
