import type { TextChannel } from "discord.js";

import { formatPingMentions, parsePingIds, type Database } from "../../core/database.js";
import type { ModuleContext } from "../../core/types.js";
import { buildYoutubeAlertPayload } from "./alerts.js";
import {
  getAllYoutubeSubscriptions,
  getDiscordChannelIdForAlertType,
  getDistinctYoutubeChannelIdsForGuild,
  getLastAlertId,
  updateLastAlertId,
} from "./database.js";
import { log } from "./log.js";
import type { YoutubeContentAlert } from "./types.js";
import { YoutubeApiClient } from "./youtube-api.js";

export interface SyncResult {
  checked: number;
  live: number;
  videos: number;
  posts: number;
  alerted: number;
}

export class YoutubePoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private api: YoutubeApiClient | null = null;

  constructor(
    private readonly db: Database,
    private readonly getClient: () => ModuleContext["client"],
    private readonly pollIntervalMs: number,
    private readonly apiKey: string,
    private readonly guildId: string,
  ) {}

  start(): void {
    if (this.interval) {
      return;
    }

    this.api = new YoutubeApiClient(this.apiKey);
    log.info(
      { intervalSeconds: this.pollIntervalMs / 1000, guildId: this.guildId },
      "Polling started",
    );

    void this.poll();
    this.interval = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.api = null;
  }

  async syncNow(): Promise<SyncResult> {
    if (!this.api) {
      this.api = new YoutubeApiClient(this.apiKey);
    }

    return this.runChecks({ force: true });
  }

  private async poll(): Promise<void> {
    if (!this.api) {
      return;
    }

    await this.runChecks({ force: false });
  }

  private async runChecks(options: { force: boolean }): Promise<SyncResult> {
    const result: SyncResult = {
      checked: 0,
      live: 0,
      videos: 0,
      posts: 0,
      alerted: 0,
    };

    const channelIds = getDistinctYoutubeChannelIdsForGuild(
      this.db,
      this.guildId,
    );
    if (channelIds.length === 0) {
      return result;
    }

    for (const channelId of channelIds) {
      result.checked += 1;

      try {
        const [live, video, post] = await Promise.all([
          this.api!.getLiveStream(channelId),
          this.api!.getLatestUpload(channelId),
          this.api!.getLatestCommunityPost(channelId),
        ]);

        if (live) {
          result.live += 1;
        }
        if (video) {
          result.videos += 1;
        }
        if (post) {
          result.posts += 1;
        }

        const alerts: YoutubeContentAlert[] = [
          ...(live ? [live] : []),
          ...(video ? [video] : []),
          ...(post ? [post] : []),
        ];

        for (const alert of alerts) {
          result.alerted += await this.notifySubscribers(
            channelId,
            alert,
            options.force,
          );
        }
      } catch (error) {
        log.error({ err: error, channelId }, "Failed to check channel");
      }
    }

    return result;
  }

  private async notifySubscribers(
    channelId: string,
    alert: YoutubeContentAlert,
    force: boolean,
  ): Promise<number> {
    const subscriptions = getAllYoutubeSubscriptions(this.db).filter(
      (sub) =>
        sub.youtube_channel_id === channelId && sub.guild_id === this.guildId,
    );

    const discordChannelId = (sub: (typeof subscriptions)[number]) =>
      getDiscordChannelIdForAlertType(sub, alert.type);

    const relevantSubs = subscriptions.filter((sub) => discordChannelId(sub));
    if (relevantSubs.length === 0) {
      return 0;
    }

    const client = this.getClient();
    if (!client.isReady()) {
      return 0;
    }

    let alerted = 0;
    let shouldUpdateLastId = false;

    for (const sub of relevantSubs) {
      const targetChannelId = discordChannelId(sub)!;
      const lastId = getLastAlertId(sub, alert.type);

      if (!force && lastId === alert.contentId) {
        continue;
      }

      const channel = await client.channels
        .fetch(targetChannelId)
        .catch(() => null);

      if (!channel?.isTextBased()) {
        continue;
      }

      const textChannel = channel as TextChannel;
      const roleIds = parsePingIds(sub.ping_role_ids);
      const userIds = parsePingIds(sub.ping_user_ids);
      const pingContent = formatPingMentions(roleIds, userIds);
      const { embed, components } = buildYoutubeAlertPayload(alert);

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
            { err: error, alertType: alert.type, channelId: targetChannelId },
            "Failed to send alert",
          );
          return false;
        });

      if (sent) {
        alerted += 1;
        shouldUpdateLastId = true;
      }
    }

    if (shouldUpdateLastId || force) {
      const anySubNeedsUpdate = relevantSubs.some((sub) => {
        const lastId = getLastAlertId(sub, alert.type);
        return force || lastId !== alert.contentId;
      });

      if (anySubNeedsUpdate) {
        updateLastAlertId(this.db, channelId, alert.type, alert.contentId);
      }
    }

    return alerted;
  }
}
