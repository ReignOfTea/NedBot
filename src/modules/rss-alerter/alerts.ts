import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
} from "discord.js";

import type { RssFeedAlert } from "./types.js";

export function buildRssAlertPayload(alert: RssFeedAlert): {
  embed: APIEmbed;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const { item, feedTitle } = alert;
  const description = item.summary || "New feed item";

  const embed: APIEmbed = {
    title: item.title || "New feed item",
    description: description.slice(0, 4096),
    url: item.link,
    color: 0xf57c00,
    image: item.imageUrl ? { url: item.imageUrl } : undefined,
    footer: { text: feedTitle },
    timestamp: item.published,
  };

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Open")
      .setStyle(ButtonStyle.Link)
      .setURL(item.link),
  );

  return { embed, components: [row] };
}
