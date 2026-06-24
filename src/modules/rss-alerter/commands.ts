import {
  ApplicationCommandOptionType,
  ChannelType,
  type CommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
  type Role,
  type User,
} from "discord.js";
import {
  Discord,
  Guard,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";

import { parsePingIds } from "../../core/database.js";
import { AllowedGuildOnly } from "../../core/guards.js";
import { DeferEphemeral, editEphemeral } from "../../core/interactions.js";
import { getModuleContext } from "../../core/module-loader.js";
import {
  addSubscriptionPing,
  clearSubscriptionPings,
  describeSubscription,
  getRssSubscription,
  getRssSubscriptionsByGuild,
  removeRssSubscription,
  removeSubscriptionPing,
  updateRssMatchRegex,
  upsertRssSubscription,
} from "./database.js";
import { fetchFeed } from "./feed-api.js";
import { validateFeedUrl } from "./feed-url.js";
import {
  compileMatchRegex,
  itemMatchesRegex,
} from "./matcher.js";
import {
  describePingTargets,
  pingTargetFromMentionable,
} from "./ping-targets.js";
import { getRssPoller } from "./runtime.js";
import { DEFAULT_MATCH_FIELDS } from "./types.js";

const REGEX_HINT =
  "Use a JavaScript regex. Example for English Ned: `(EnglishNed|English Ned)` (matching is case-insensitive).";

@Discord()
@SlashGroup({
  description: "RSS and Atom feed alerts with regex filtering",
  name: "rss",
})
@Guard(AllowedGuildOnly, DeferEphemeral)
export class RssCommands {
  @Slash({
    description: "Subscribe to an RSS/Atom feed with regex filtering",
    name: "subscribe",
  })
  @SlashGroup("rss")
  async subscribe(
    @SlashOption({
      description: "Feed URL (RSS 2.0 or Atom)",
      name: "feed-url",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    feedUrlInput: string,
    @SlashOption({
      description: "Regex matched against title and summary/description",
      name: "match-regex",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    matchRegex: string,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Discord channel to post matching items in",
      name: "alert-channel",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    alertChannel: GuildTextBasedChannel,
    @SlashOption({
      description: "Optional label for this subscription in /rss list",
      name: "label",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    label: string | undefined,
    @SlashOption({
      description: "Role to @mention when a matching item is found",
      name: "ping-role",
      required: false,
      type: ApplicationCommandOptionType.Role,
    })
    pingRole: Role | undefined,
    @SlashOption({
      description: "User to @mention when a matching item is found",
      name: "ping-user",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    pingUser: User | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const { db } = getModuleContext();

    try {
      const feedUrl = validateFeedUrl(feedUrlInput);
      compileMatchRegex(matchRegex);
      const feed = await fetchFeed(feedUrl);
      const newestEntryId = feed.items[0]?.id ?? null;

      const sub = upsertRssSubscription(db, {
        guildId: interaction.guildId!,
        feedUrl,
        feedTitle: feed.title,
        label: label?.trim() || null,
        discordChannelId: alertChannel.id,
        matchRegex,
        matchFields: [...DEFAULT_MATCH_FIELDS],
        lastEntryId: newestEntryId,
      });

      if (pingRole) {
        addSubscriptionPing(db, interaction.guildId!, sub.id, {
          type: "role",
          id: pingRole.id,
        });
      }

      if (pingUser) {
        addSubscriptionPing(db, interaction.guildId!, sub.id, {
          type: "user",
          id: pingUser.id,
        });
      }

      const saved = getRssSubscription(db, interaction.guildId!, sub.id);
      const pingSummary = saved
        ? describePingTargets(
            parsePingIds(saved.ping_role_ids),
            parsePingIds(saved.ping_user_ids),
          )
        : describePingTargets(
            pingRole ? [pingRole.id] : [],
            pingUser ? [pingUser.id] : [],
          );

      await editEphemeral(
        interaction,
        [
          `Subscribed to **${feed.title}**`,
          `Feed: ${feedUrl}`,
          `Regex: \`${matchRegex}\``,
          `Alerts → ${alertChannel}`,
          `Subscription ID: **#${sub.id}**`,
          `Ping targets: ${pingSummary}`,
          "Only **new** feed items after subscribe will alert automatically.",
          "To post existing matches, run `/rss backfill id:" + sub.id + "`.",
          REGEX_HINT,
        ].join("\n"),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await editEphemeral(interaction, `Subscribe failed: ${message}`);
    }
  }

  @Slash({
    description: "Unsubscribe by subscription ID (from /rss list)",
    name: "unsubscribe",
  })
  @SlashGroup("rss")
  async unsubscribe(
    @SlashOption({
      description: "Subscription ID",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    subscriptionId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    const { db } = getModuleContext();
    const removed = removeRssSubscription(
      db,
      interaction.guildId!,
      subscriptionId,
    );

    if (!removed) {
      await editEphemeral(
        interaction,
        `No subscription found with ID **#${subscriptionId}**.`,
      );
      return;
    }

    await editEphemeral(
      interaction,
      `Removed subscription **#${subscriptionId}**.`,
    );
  }

  @Slash({
    description: "Update the match regex for a subscription",
    name: "set-regex",
  })
  @SlashGroup("rss")
  async setRegex(
    @SlashOption({
      description: "Subscription ID",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    subscriptionId: number,
    @SlashOption({
      description: "New regex pattern",
      name: "match-regex",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    matchRegex: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const { db } = getModuleContext();

    try {
      compileMatchRegex(matchRegex);
      const updated = updateRssMatchRegex(
        db,
        interaction.guildId!,
        subscriptionId,
        matchRegex,
      );

      if (!updated) {
        await editEphemeral(
          interaction,
          `No subscription found with ID **#${subscriptionId}**.`,
        );
        return;
      }

      await editEphemeral(
        interaction,
        `Updated subscription **#${subscriptionId}** regex to \`${matchRegex}\`.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await editEphemeral(interaction, message);
    }
  }

  @Slash({
    description: "Preview which recent feed items match a regex",
    name: "test",
  })
  @SlashGroup("rss")
  async test(
    @SlashOption({
      description: "Feed URL to test",
      name: "feed-url",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    feedUrlInput: string,
    @SlashOption({
      description: "Regex to test against title and summary",
      name: "match-regex",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    matchRegex: string,
    @SlashOption({
      description: "How many recent items to scan (default 20)",
      name: "limit",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    limit: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      const feedUrl = validateFeedUrl(feedUrlInput);
      const regex = compileMatchRegex(matchRegex);
      const feed = await fetchFeed(feedUrl);
      const scanLimit = Math.min(Math.max(limit ?? 20, 1), 50);

      const matches = feed.items
        .slice(0, scanLimit)
        .filter((item) =>
          itemMatchesRegex(item, regex, [...DEFAULT_MATCH_FIELDS]),
        );

      if (matches.length === 0) {
        await editEphemeral(
          interaction,
          [
            `No matches in the last **${scanLimit}** items from **${feed.title}**.`,
            REGEX_HINT,
          ].join("\n"),
        );
        return;
      }

      const lines = matches.slice(0, 10).map((item) => {
        const summary = item.summary
          ? item.summary.slice(0, 120)
          : "(no summary)";
        return `• **${item.title}** — ${summary}${item.summary.length > 120 ? "…" : ""}\n  ${item.link}`;
      });

      await editEphemeral(
        interaction,
        [
          `**${matches.length}** match(es) in the last **${scanLimit}** items from **${feed.title}**:`,
          ...lines,
          matches.length > 10
            ? `_…and ${matches.length - 10} more not shown_`
            : "",
        ].join("\n"),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await editEphemeral(interaction, `Test failed: ${message}`);
    }
  }

  @Slash({
    description: "List RSS subscriptions for this server",
    name: "list",
  })
  @SlashGroup("rss")
  async list(interaction: CommandInteraction): Promise<void> {
    const { db } = getModuleContext();
    const subs = getRssSubscriptionsByGuild(db, interaction.guildId!);

    if (subs.length === 0) {
      await editEphemeral(
        interaction,
        "No RSS subscriptions. Use `/rss subscribe` to add one.",
      );
      return;
    }

    await editEphemeral(
      interaction,
      subs.map((sub) => describeSubscription(sub)).join("\n"),
    );
  }

  @Slash({
    description: "Post alerts for existing feed items that match the regex",
    name: "backfill",
  })
  @SlashGroup("rss")
  async backfill(
    @SlashOption({
      description: "Subscription ID (from /rss list)",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    subscriptionId: number,
    @SlashOption({
      description: "How many recent feed items to scan (default 50)",
      name: "limit",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    limit: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const poller = getRssPoller();
    if (!poller) {
      await editEphemeral(interaction, "RSS alerter is not running.");
      return;
    }

    try {
      const result = await poller.backfillSubscription(
        subscriptionId,
        limit ?? 50,
      );

      if (!result) {
        await editEphemeral(
          interaction,
          `No subscription found with ID **#${subscriptionId}**.`,
        );
        return;
      }

      await editEphemeral(
        interaction,
        [
          "Backfill complete.",
          `Matches found: **${result.matched}**`,
          `Alerts sent: **${result.alerted}**`,
          result.skipped > 0
            ? `Already alerted (skipped): **${result.skipped}**`
            : "",
          "Future new items will still be picked up automatically.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await editEphemeral(interaction, `Backfill failed: ${message}`);
    }
  }

  @Slash({
    description: "Check all feeds now for new matching items",
    name: "sync",
  })
  @SlashGroup("rss")
  async sync(interaction: CommandInteraction): Promise<void> {
    const poller = getRssPoller();
    if (!poller) {
      await editEphemeral(interaction, "RSS alerter is not running.");
      return;
    }

    const result = await poller.syncNow();
    await editEphemeral(
      interaction,
      [
        "Sync complete.",
        `Feeds checked: **${result.feedsChecked}**`,
        `Subscriptions: **${result.subscriptionsChecked}**`,
        `Matches: **${result.matched}**`,
        `Alerts sent: **${result.alerted}**`,
      ].join("\n"),
    );
  }

  @Slash({
    description: "Add a user or role to ping for a subscription",
    name: "ping-add",
  })
  @SlashGroup("rss")
  async pingAdd(
    @SlashOption({
      description: "Subscription ID",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    subscriptionId: number,
    @SlashOption({
      description: "User or role to ping",
      name: "target",
      required: true,
      type: ApplicationCommandOptionType.Mentionable,
    })
    target: GuildMember | Role | User,
    interaction: CommandInteraction,
  ): Promise<void> {
    const { db } = getModuleContext();
    const pingTarget = pingTargetFromMentionable(target);
    const updated = addSubscriptionPing(
      db,
      interaction.guildId!,
      subscriptionId,
      pingTarget,
    );

    if (!updated) {
      await editEphemeral(
        interaction,
        `No subscription found with ID **#${subscriptionId}**.`,
      );
      return;
    }

    await editEphemeral(
      interaction,
      `Added ping target for subscription **#${subscriptionId}**.`,
    );
  }

  @Slash({
    description: "Remove a user or role from pings for a subscription",
    name: "ping-remove",
  })
  @SlashGroup("rss")
  async pingRemove(
    @SlashOption({
      description: "Subscription ID",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    subscriptionId: number,
    @SlashOption({
      description: "User or role to remove",
      name: "target",
      required: true,
      type: ApplicationCommandOptionType.Mentionable,
    })
    target: GuildMember | Role | User,
    interaction: CommandInteraction,
  ): Promise<void> {
    const { db } = getModuleContext();
    const pingTarget = pingTargetFromMentionable(target);
    const updated = removeSubscriptionPing(
      db,
      interaction.guildId!,
      subscriptionId,
      pingTarget,
    );

    if (!updated) {
      await editEphemeral(
        interaction,
        `No subscription found with ID **#${subscriptionId}**.`,
      );
      return;
    }

    await editEphemeral(
      interaction,
      `Removed ping target for subscription **#${subscriptionId}**.`,
    );
  }

  @Slash({
    description: "Clear all ping targets for a subscription",
    name: "ping-clear",
  })
  @SlashGroup("rss")
  async pingClear(
    @SlashOption({
      description: "Subscription ID",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    subscriptionId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    const { db } = getModuleContext();
    const updated = clearSubscriptionPings(
      db,
      interaction.guildId!,
      subscriptionId,
    );

    if (!updated) {
      await editEphemeral(
        interaction,
        `No subscription found with ID **#${subscriptionId}**.`,
      );
      return;
    }

    await editEphemeral(
      interaction,
      `Cleared ping targets for subscription **#${subscriptionId}**.`,
    );
  }
}
