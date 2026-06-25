import type { TextChannel } from "discord.js";

import { announceInBotsChannel } from "../../core/bots-channel.js";
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
import { computeYoutubePollIntervalMs } from "./poll-interval.js";
import type { YoutubeContentAlert } from "./types.js";
import { YoutubeApiClient } from "./youtube-api.js";
import {
  clearYoutubeQuotaPauseIfExpired,
  getYoutubeQuotaPausedIntervalMs,
  getYoutubeQuotaPausedUntil,
  isYoutubeQuotaExceededError,
  isYoutubeQuotaPaused,
  markYoutubeQuotaPauseAnnounced,
  noteYoutubeQuotaPause,
  shouldAnnounceYoutubeQuotaPause,
} from "./youtube-quota.js";

export interface SyncResult {
  checked: number;
  live: number;
  videos: number;
  posts: number;
  alerted: number;
  quotaPaused: boolean;
  liveOnly: boolean;
}

export interface YoutubePollerStatus {
  channelCount: number;
  pollIntervalSeconds: number;
  quotaBudgetPerDay: number;
  quotaPausedUntil: string | null;
  communityPostChecksEnabled: boolean;
  unitsPerChannelCheck: number;
}

export class YoutubePoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs = 0;
  private api: YoutubeApiClient | null = null;

  constructor(
    private readonly db: Database,
    private readonly getClient: () => ModuleContext["client"],
    private readonly quotaBudgetPerDay: number,
    private readonly apiKey: string,
    private readonly guildId: string,
    private readonly botsChannelId: string,
    private readonly communityPostChecksEnabled: boolean,
    private readonly unitsPerChannelCheck: number,
  ) {}

  start(): void {
    if (this.interval) {
      return;
    }

    this.api = new YoutubeApiClient(
      this.apiKey,
      this.communityPostChecksEnabled,
    );
    this.applyPollInterval();
    void this.poll();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.pollIntervalMs = 0;
    this.api = null;
  }

  rescheduleInterval(): void {
    if (!this.api) {
      return;
    }
    this.applyPollInterval();
  }

  getStatus(): YoutubePollerStatus {
    const channelCount = getDistinctYoutubeChannelIdsForGuild(
      this.db,
      this.guildId,
    ).length;

    return {
      channelCount,
      pollIntervalSeconds: this.pollIntervalMs / 1000,
      quotaBudgetPerDay: this.quotaBudgetPerDay,
      quotaPausedUntil: getYoutubeQuotaPausedUntil()?.toISOString() ?? null,
      communityPostChecksEnabled: this.communityPostChecksEnabled,
      unitsPerChannelCheck: this.unitsPerChannelCheck,
    };
  }

  private applyPollInterval(): void {
    clearYoutubeQuotaPauseIfExpired();

    const pausedIntervalMs = getYoutubeQuotaPausedIntervalMs();
    const channelCount = getDistinctYoutubeChannelIdsForGuild(
      this.db,
      this.guildId,
    ).length;
    const nextMs =
      pausedIntervalMs ??
      computeYoutubePollIntervalMs(
        channelCount,
        this.quotaBudgetPerDay,
        this.unitsPerChannelCheck,
      );

    if (this.interval && nextMs === this.pollIntervalMs) {
      return;
    }

    if (this.interval) {
      clearInterval(this.interval);
    }

    this.pollIntervalMs = nextMs;

    if (pausedIntervalMs !== null) {
      if (noteYoutubeQuotaPause()) {
        void this.announceQuotaPauseIfNeeded();
      }
      log.info(
        {
          intervalSeconds: nextMs / 1000,
          guildId: this.guildId,
          paused: true,
        },
        "YouTube polling paused until quota reset",
      );
    } else {
      log.info(
        {
          intervalSeconds: nextMs / 1000,
          channelCount,
          quotaBudgetPerDay: this.quotaBudgetPerDay,
          guildId: this.guildId,
        },
        "Polling interval updated",
      );
    }

    this.interval = setInterval(() => void this.poll(), nextMs);
  }

  async syncNow(): Promise<SyncResult> {
    if (!this.api) {
      this.api = new YoutubeApiClient(
        this.apiKey,
        this.communityPostChecksEnabled,
      );
    }

    return this.runChecks({ force: true });
  }

  private async poll(): Promise<void> {
    if (!this.api) {
      return;
    }

    await this.runChecks({ force: false });
    this.applyPollInterval();
  }

  private async runChecks(options: { force: boolean }): Promise<SyncResult> {
    const result: SyncResult = {
      checked: 0,
      live: 0,
      videos: 0,
      posts: 0,
      alerted: 0,
      quotaPaused: false,
      liveOnly: false,
    };

    clearYoutubeQuotaPauseIfExpired();
    const quotaPaused = isYoutubeQuotaPaused();
    result.quotaPaused = quotaPaused;
    result.liveOnly = quotaPaused;

    if (quotaPaused) {
      if (noteYoutubeQuotaPause()) {
        void this.announceQuotaPauseIfNeeded();
      }
    }

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
        const { live, upload, post } = await this.api!.checkChannel(channelId);

        if (live) {
          result.live += 1;
        }
        if (upload) {
          result.videos += 1;
        }
        if (post) {
          result.posts += 1;
        }

        const alerts: YoutubeContentAlert[] = [
          ...(live ? [live] : []),
          ...(upload ? [upload] : []),
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
        if (isYoutubeQuotaExceededError(error)) {
          if (noteYoutubeQuotaPause()) {
            void this.announceQuotaPauseIfNeeded();
          }
          this.applyPollInterval();
          result.quotaPaused = true;
          result.liveOnly = true;
          break;
        }

        log.error({ err: error, channelId }, "Failed to check channel");
      }
    }

    return result;
  }

  private async announceQuotaPauseIfNeeded(): Promise<void> {
    if (!shouldAnnounceYoutubeQuotaPause()) {
      return;
    }

    const resumeAt = getYoutubeQuotaPausedUntil();
    if (!resumeAt) {
      return;
    }

    markYoutubeQuotaPauseAnnounced();
    await announceInBotsChannel(
      this.getClient(),
      this.guildId,
      this.botsChannelId,
      `YouTube API quota exceeded. API polling paused until <t:${Math.floor(resumeAt.getTime() / 1000)}:f> (midnight Pacific). Live scrape checks continue.`,
    );
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
