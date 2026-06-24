import type { TextChannel } from "discord.js";

import { formatPingMentions, parsePingIds, type Database } from "../../core/database.js";
import type { ModuleContext } from "../../core/types.js";
import { buildRssAlertPayload } from "./alerts.js";
import {
  getDistinctFeedUrlsForGuild,
  getRssSubscription,
  getRssSubscriptionsByFeed,
  hasAlertedEntry,
  parseMatchFields,
  recordAlertedEntry,
  type RssSubscriptionRow,
  updateLastEntryId,
} from "./database.js";
import { fetchFeed } from "./feed-api.js";
import { log } from "./log.js";
import {
  compileMatchRegex,
  getNewEntries,
  itemMatchesRegex,
} from "./matcher.js";
import type { RssFeedItem } from "./types.js";

export interface SyncResult {
  feedsChecked: number;
  subscriptionsChecked: number;
  matched: number;
  alerted: number;
}

export interface BackfillResult {
  matched: number;
  alerted: number;
  skipped: number;
}

export class RssPoller {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: Database,
    private readonly getClient: () => ModuleContext["client"],
    private readonly pollIntervalMs: number,
    private readonly guildId: string,
  ) {}

  start(): void {
    if (this.interval) {
      return;
    }

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
  }

  async syncNow(): Promise<SyncResult> {
    return this.runChecks();
  }

  async backfillSubscription(
    subscriptionId: number,
    limit: number,
  ): Promise<BackfillResult | null> {
    const subscription = getRssSubscription(
      this.db,
      this.guildId,
      subscriptionId,
    );
    if (!subscription) {
      return null;
    }

    const feed = await fetchFeed(subscription.feed_url);
    const regex = compileMatchRegex(subscription.match_regex);
    const fields = parseMatchFields(subscription.match_fields);
    const scanLimit = Math.min(Math.max(limit, 1), 200);

    const matches = feed.items
      .slice(0, scanLimit)
      .filter((item) => itemMatchesRegex(item, regex, fields))
      .reverse();

    const result: BackfillResult = {
      matched: matches.length,
      alerted: 0,
      skipped: 0,
    };

    for (const item of matches) {
      if (hasAlertedEntry(this.db, subscription.id, item.id)) {
        result.skipped += 1;
        continue;
      }

      const sent = await this.sendAlert(subscription, item, feed.title);
      if (sent) {
        recordAlertedEntry(this.db, subscription.id, item.id);
        result.alerted += 1;
      }
    }

    return result;
  }

  private async poll(): Promise<void> {
    await this.runChecks();
  }

  private async runChecks(): Promise<SyncResult> {
    const result: SyncResult = {
      feedsChecked: 0,
      subscriptionsChecked: 0,
      matched: 0,
      alerted: 0,
    };

    const feedUrls = getDistinctFeedUrlsForGuild(this.db, this.guildId);
    if (feedUrls.length === 0) {
      return result;
    }

    for (const feedUrl of feedUrls) {
      result.feedsChecked += 1;

      try {
        const feed = await fetchFeed(feedUrl);
        const subscriptions = getRssSubscriptionsByFeed(this.db, feedUrl).filter(
          (sub) => sub.guild_id === this.guildId,
        );

        for (const subscription of subscriptions) {
          result.subscriptionsChecked += 1;
          const check = await this.processSubscription(
            subscription,
            feed.items,
            feed.title,
          );
          result.matched += check.matched;
          result.alerted += check.alerted;
        }
      } catch (error) {
        log.error({ err: error, feedUrl }, "Failed to check feed");
      }
    }

    return result;
  }

  private async processSubscription(
    subscription: RssSubscriptionRow,
    items: RssFeedItem[],
    feedTitle: string,
  ): Promise<{ matched: number; alerted: number }> {
    const regex = compileMatchRegex(subscription.match_regex);
    const fields = parseMatchFields(subscription.match_fields);
    const newEntries = getNewEntries(items, subscription.last_entry_id);

    if (items.length > 0) {
      updateLastEntryId(this.db, subscription.id, items[0]!.id);
    }

    let matched = 0;
    let alerted = 0;

    for (const item of newEntries) {
      if (!itemMatchesRegex(item, regex, fields)) {
        continue;
      }

      if (hasAlertedEntry(this.db, subscription.id, item.id)) {
        continue;
      }

      matched += 1;
      const sent = await this.sendAlert(subscription, item, feedTitle);
      if (sent) {
        recordAlertedEntry(this.db, subscription.id, item.id);
        alerted += 1;
      }
    }

    return { matched, alerted };
  }

  private async sendAlert(
    subscription: RssSubscriptionRow,
    item: RssFeedItem,
    feedTitle: string,
  ): Promise<boolean> {
    const client = this.getClient();
    if (!client.isReady()) {
      return false;
    }

    const channel = await client.channels
      .fetch(subscription.discord_channel_id)
      .catch(() => null);

    if (!channel?.isTextBased()) {
      return false;
    }

    const textChannel = channel as TextChannel;
    const roleIds = parsePingIds(subscription.ping_role_ids);
    const userIds = parsePingIds(subscription.ping_user_ids);
    const pingContent = formatPingMentions(roleIds, userIds);
    const { embed, components } = buildRssAlertPayload({
      feedUrl: subscription.feed_url,
      feedTitle: subscription.feed_title || feedTitle,
      item,
    });

    return textChannel
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
          {
            err: error,
            subscriptionId: subscription.id,
            channelId: subscription.discord_channel_id,
          },
          "Failed to send RSS alert",
        );
        return false;
      });
  }
}
