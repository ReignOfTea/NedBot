import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
} from "discord.js";

import type { YoutubeContentAlert } from "./types.js";

export function buildYoutubeAlertPayload(alert: YoutubeContentAlert): {
  embed: APIEmbed;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = buildAlertEmbed(alert);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel(getButtonLabel(alert))
      .setStyle(ButtonStyle.Link)
      .setURL(alert.url),
  );

  return { embed, components: [row] };
}

function buildAlertEmbed(alert: YoutubeContentAlert): APIEmbed {
  switch (alert.type) {
    case "live":
      return {
        title: `🔴 ${alert.channelTitle} is live!`,
        description: alert.title,
        url: alert.url,
        color: 0xff0000,
        image: alert.thumbnailUrl ? { url: alert.thumbnailUrl } : undefined,
        footer: { text: "YouTube Live Alert" },
      };
    case "video":
      return {
        title: alert.isShort
          ? `📱 ${alert.channelTitle} posted a new Short`
          : `📹 ${alert.channelTitle} uploaded a new video`,
        description: alert.title,
        url: alert.url,
        color: 0xcc0000,
        image: alert.thumbnailUrl ? { url: alert.thumbnailUrl } : undefined,
        footer: {
          text: alert.isShort ? "YouTube Short Alert" : "YouTube Video Alert",
        },
      };
    case "post":
      return {
        title: `💬 ${alert.channelTitle} posted to Community`,
        description: alert.title,
        url: alert.url,
        color: 0x606060,
        image: alert.thumbnailUrl ? { url: alert.thumbnailUrl } : undefined,
        footer: { text: "YouTube Community Post Alert" },
      };
  }
}

function getButtonLabel(alert: YoutubeContentAlert): string {
  switch (alert.type) {
    case "live":
      return "Watch Stream";
    case "video":
      return alert.isShort ? "Watch Short" : "Watch Video";
    case "post":
      return "View Post";
  }
}
