import type { TextChannel } from "discord.js";
import {
  createClient,
  type NotificationClient,
  type TwitterNotification,
} from "xnotif";

import { formatPingMentions, parsePingIds, type Database } from "../../core/database.js";
import type { ModuleContext } from "../../core/types.js";
import { buildXAlertPayload } from "./alerts.js";
import {
  getXSubscriptionsByUsername,
  loadPushState,
  savePushState,
  updateLastPostId,
} from "./database.js";
import { log } from "./log.js";
import {
  isTweetNotification,
  parseTweetNotification,
} from "./notification-parser.js";

export interface XPushStatus {
  running: boolean;
  connected: boolean;
}

export class XPushListener {
  private client: NotificationClient | null = null;
  private connected = false;

  constructor(
    private readonly db: Database,
    private readonly getDiscordClient: () => ModuleContext["client"],
    private readonly cookies: { auth_token: string; ct0: string },
    private readonly guildId: string,
  ) {}

  getStatus(): XPushStatus {
    return {
      running: this.client !== null,
      connected: this.connected,
    };
  }

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    const savedState = loadPushState(this.db);
    const client = createClient({
      cookies: this.cookies,
      state: savedState ?? undefined,
      filter: isTweetNotification,
    });

    client.on("connected", (state) => {
      this.connected = true;
      savePushState(this.db, state);
      log.info("X push client connected");
    });

    client.on("notification", (notification) => {
      void this.handleNotification(notification);
    });

    client.on("error", (error) => {
      log.error({ err: error }, "X push client error");
    });

    client.on("disconnected", () => {
      this.connected = false;
      log.warn("X push client disconnected");
    });

    client.on("reconnecting", (delay) => {
      log.info({ delayMs: delay }, "X push client reconnecting");
    });

    await client.start();
    this.client = client;
    log.info("X push listener started");
  }

  stop(): void {
    this.client?.stop();
    this.client = null;
    this.connected = false;
    log.info("X push listener stopped");
  }

  private async handleNotification(
    notification: TwitterNotification,
  ): Promise<void> {
    const alert = parseTweetNotification(notification);
    if (!alert) {
      log.debug({ notification }, "Ignored non-tweet notification");
      return;
    }

    const subscriptions = getXSubscriptionsByUsername(
      this.db,
      alert.username,
    ).filter((sub) => sub.guild_id === this.guildId);

    if (subscriptions.length === 0) {
      log.debug({ username: alert.username }, "No Discord subscriptions for post");
      return;
    }

    const discord = this.getDiscordClient();
    if (!discord.isReady()) {
      return;
    }

    for (const sub of subscriptions) {
      if (sub.last_post_id === alert.contentId) {
        continue;
      }

      const channel = await discord.channels
        .fetch(sub.discord_channel_id)
        .catch(() => null);

      if (!channel?.isTextBased()) {
        log.warn(
          { channelId: sub.discord_channel_id },
          "Subscription alert channel unavailable",
        );
        continue;
      }

      const textChannel = channel as TextChannel;
      const roleIds = parsePingIds(sub.ping_role_ids);
      const userIds = parsePingIds(sub.ping_user_ids);
      const pingContent = formatPingMentions(roleIds, userIds);
      const { embed, components } = buildXAlertPayload(alert);

      const sent = await textChannel
        .send({
          content: pingContent || undefined,
          embeds: [embed],
          components,
          allowedMentions:
            roleIds.length > 0 || userIds.length > 0
              ? { roles: roleIds, users: userIds }
              : undefined,
        })
        .then(() => true)
        .catch((error: unknown) => {
          log.error(
            { err: error, channelId: sub.discord_channel_id },
            "Failed to send X alert",
          );
          return false;
        });

      if (sent) {
        updateLastPostId(this.db, sub.guild_id, alert.username, alert.contentId);
        log.info(
          { username: alert.username, channelId: sub.discord_channel_id },
          "Sent X post alert",
        );
      }
    }
  }
}
