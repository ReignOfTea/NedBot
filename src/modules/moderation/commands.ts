import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
  MessageFlags,
  PermissionFlagsBits,
  type User,
} from "discord.js";
import {
  Discord,
  Guard,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";

import { AllowedGuildOnly } from "../../core/guards.js";
import { getModuleContext } from "../../core/module-loader.js";
import { CommandPermission } from "../../core/permissions/index.js";
import {
  assertBotHasPermission,
  assertCanModerate,
  formatActionError,
  formatReason,
  getModeratorMember,
  ModerationError,
  reasonSuffix,
  resolveGuildMember,
} from "./checks.js";
import {
  addWarning,
  clearWarningsForUser,
  countWarningsForUser,
  deleteWarning,
  getWarningById,
  getWarningsForUser,
} from "./database.js";
import { log } from "./log.js";

const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;
const MAX_PURGE = 100;
const MAX_DELETE_MESSAGE_DAYS = 7;

@Discord()
@SlashGroup({ description: "Server moderation", name: "mod" })
@Guard(AllowedGuildOnly, CommandPermission)
export class ModerationCommands {
  @Slash({ description: "Kick a member from the server", name: "kick" })
  @SlashGroup("mod")
  async kick(
    @SlashOption({
      description: "Member to kick",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashOption({
      description: "Reason for the kick",
      name: "reason",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    reason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await this.runMemberAction(interaction, user.id, async (guild, _moderator, target) => {
      assertBotHasPermission(guild, PermissionFlagsBits.KickMembers);
      await target.kick(formatReason(reason));
      return `**${target.user.tag}** was kicked.${reasonSuffix(reason)}`;
    });
  }

  @Slash({ description: "Ban a member from the server", name: "ban" })
  @SlashGroup("mod")
  async ban(
    @SlashOption({
      description: "Member to ban",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashOption({
      description: "Delete recent messages (days, 0–7)",
      name: "delete_days",
      required: false,
      type: ApplicationCommandOptionType.Integer,
      minValue: 0,
      maxValue: MAX_DELETE_MESSAGE_DAYS,
    })
    deleteDays: number | undefined,
    @SlashOption({
      description: "Reason for the ban",
      name: "reason",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    reason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await this.runMemberAction(interaction, user.id, async (guild, _moderator, target) => {
      assertBotHasPermission(guild, PermissionFlagsBits.BanMembers);
      const days = deleteDays ?? 0;
      await target.ban({
        deleteMessageSeconds: days * 24 * 60 * 60,
        reason: formatReason(reason),
      });
      const deleteLine =
        days > 0 ? ` Deleted messages from the last **${days}** day(s).` : "";
      return `**${target.user.tag}** was banned.${deleteLine}${reasonSuffix(reason)}`;
    });
  }

  @Slash({ description: "Unban a user by ID", name: "unban" })
  @SlashGroup("mod")
  async unban(
    @SlashOption({
      description: "User ID to unban",
      name: "user_id",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    userId: string,
    @SlashOption({
      description: "Reason for the unban",
      name: "reason",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    reason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const guild = interaction.guild;
      if (!guild) {
        throw new ModerationError("This command can only be used in a server.");
      }

      getModeratorMember(interaction);
      assertBotHasPermission(guild, PermissionFlagsBits.BanMembers);

      const normalizedId = userId.trim();
      if (!/^\d{17,20}$/.test(normalizedId)) {
        throw new ModerationError("Invalid user ID.");
      }

      const ban = await guild.bans.fetch(normalizedId).catch(() => null);
      if (!ban) {
        throw new ModerationError("That user is not banned.");
      }

      await guild.members.unban(normalizedId, formatReason(reason));
      await interaction.editReply(
        `**${ban.user.tag}** was unbanned.${reasonSuffix(reason)}`,
      );
    } catch (error) {
      await interaction.editReply(formatActionError(error));
    }
  }

  @Slash({ description: "Timeout (mute) a member", name: "timeout" })
  @SlashGroup("mod")
  async timeout(
    @SlashOption({
      description: "Member to timeout",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashOption({
      description: "Duration in minutes (max 40320 = 28 days)",
      name: "minutes",
      required: true,
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
      maxValue: MAX_TIMEOUT_MINUTES,
    })
    minutes: number,
    @SlashOption({
      description: "Reason for the timeout",
      name: "reason",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    reason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await this.runMemberAction(interaction, user.id, async (guild, _moderator, target) => {
      assertBotHasPermission(guild, PermissionFlagsBits.ModerateMembers);
      await target.timeout(minutes * 60_000, formatReason(reason));
      return `**${target.user.tag}** was timed out for **${formatDuration(minutes)}**.${reasonSuffix(reason)}`;
    });
  }

  @Slash({ description: "Remove a member's timeout", name: "untimeout" })
  @SlashGroup("mod")
  async untimeout(
    @SlashOption({
      description: "Member to remove timeout from",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashOption({
      description: "Reason for removing the timeout",
      name: "reason",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    reason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await this.runMemberAction(interaction, user.id, async (guild, _moderator, target) => {
      assertBotHasPermission(guild, PermissionFlagsBits.ModerateMembers);

      if (!target.communicationDisabledUntil) {
        throw new ModerationError("That member is not timed out.");
      }

      await target.timeout(null, formatReason(reason));
      return `Timeout removed for **${target.user.tag}**.${reasonSuffix(reason)}`;
    });
  }

  @Slash({ description: "Warn a member", name: "warn" })
  @SlashGroup("mod")
  async warn(
    @SlashOption({
      description: "Member to warn",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashOption({
      description: "Reason for the warning",
      name: "reason",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    reason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const guild = interaction.guild;
      if (!guild) {
        throw new ModerationError("This command can only be used in a server.");
      }

      const moderator = getModeratorMember(interaction);
      const target = await resolveGuildMember(guild, user.id);
      assertCanModerate(guild, moderator, target);

      const { db } = getModuleContext();
      const warning = addWarning(
        db,
        guild.id,
        target.id,
        moderator.id,
        reason?.trim() || null,
      );
      const total = countWarningsForUser(db, guild.id, target.id);

      await interaction.editReply(
        `Warned **${target.user.tag}** (\`#${warning.id}\`). They now have **${total}** warning(s).${reasonSuffix(reason)}`,
      );
    } catch (error) {
      await interaction.editReply(formatActionError(error));
    }
  }

  @Slash({ description: "List warnings for a member", name: "warnings" })
  @SlashGroup("mod")
  async warnings(
    @SlashOption({
      description: "Member to inspect",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = interaction.guild;
      if (!guild) {
        throw new ModerationError("This command can only be used in a server.");
      }

      const { db } = getModuleContext();
      const rows = getWarningsForUser(db, guild.id, user.id);
      const total = countWarningsForUser(db, guild.id, user.id);

      if (rows.length === 0) {
        await interaction.editReply(`**${user.tag}** has no warnings.`);
        return;
      }

      const lines = rows.map((warning) => {
        const reason = warning.reason ? ` — ${warning.reason}` : "";
        return `- \`#${warning.id}\` <t:${Math.floor(new Date(warning.createdAt).getTime() / 1000)}:f> by <@${warning.moderatorId}>${reason}`;
      });

      const suffix =
        total > rows.length ? `\n… and **${total - rows.length}** older warning(s).` : "";

      await interaction.editReply(
        `**${user.tag}** — **${total}** warning(s)\n${lines.join("\n")}${suffix}`,
      );
    } catch (error) {
      await interaction.editReply(formatActionError(error));
    }
  }

  @Slash({ description: "Delete a warning by ID", name: "delwarn" })
  @SlashGroup("mod")
  async delwarn(
    @SlashOption({
      description: "Warning ID from /mod warnings",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
    })
    id: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = interaction.guild;
      if (!guild) {
        throw new ModerationError("This command can only be used in a server.");
      }

      const { db } = getModuleContext();
      const warning = getWarningById(db, id);
      if (!warning || warning.guildId !== guild.id) {
        throw new ModerationError(`Warning \`#${id}\` was not found.`);
      }

      deleteWarning(db, guild.id, id);
      const remaining = countWarningsForUser(db, guild.id, warning.userId);

      await interaction.editReply(
        `Deleted warning \`#${id}\` for <@${warning.userId}>. **${remaining}** warning(s) remain.`,
      );
    } catch (error) {
      await interaction.editReply(formatActionError(error));
    }
  }

  @Slash({ description: "Clear all warnings for a member", name: "clearwarns" })
  @SlashGroup("mod")
  async clearwarns(
    @SlashOption({
      description: "Member to clear warnings for",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = interaction.guild;
      if (!guild) {
        throw new ModerationError("This command can only be used in a server.");
      }

      const { db } = getModuleContext();
      const removed = clearWarningsForUser(db, guild.id, user.id);

      await interaction.editReply(
        removed > 0
          ? `Cleared **${removed}** warning(s) for **${user.tag}**.`
          : `**${user.tag}** had no warnings.`,
      );
    } catch (error) {
      await interaction.editReply(formatActionError(error));
    }
  }

  @Slash({ description: "Bulk-delete messages in this channel", name: "purge" })
  @SlashGroup("mod")
  async purge(
    @SlashOption({
      description: "Number of messages to delete (1–100)",
      name: "amount",
      required: true,
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
      maxValue: MAX_PURGE,
    })
    amount: number,
    @SlashOption({
      description: "Only delete messages from this user",
      name: "user",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    user: User | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = interaction.guild;
      const channel = interaction.channel;
      if (!guild || !channel?.isTextBased()) {
        throw new ModerationError("This command can only be used in a text channel.");
      }

      getModeratorMember(interaction);
      assertBotHasPermission(guild, PermissionFlagsBits.ManageMessages);

      const textChannel = channel as GuildTextBasedChannel;
      const fetched = await textChannel.messages.fetch({ limit: amount });

      const eligible = fetched.filter((message) => {
        if (user && message.author.id !== user.id) {
          return false;
        }

        const ageMs = Date.now() - message.createdTimestamp;
        return ageMs < 14 * 24 * 60 * 60 * 1000;
      });

      if (eligible.size === 0) {
        throw new ModerationError(
          "No deletable messages found (messages older than 14 days cannot be bulk-deleted).",
        );
      }

      const deleted = await textChannel.bulkDelete(eligible, true);
      const filterLine = user ? ` from **${user.tag}**` : "";

      await interaction.editReply(
        `Deleted **${deleted.size}** message(s)${filterLine}.`,
      );
    } catch (error) {
      await interaction.editReply(formatActionError(error));
    }
  }

  private async runMemberAction(
    interaction: CommandInteraction,
    userId: string,
    action: (
      guild: NonNullable<CommandInteraction["guild"]>,
      moderator: GuildMember,
      target: GuildMember,
    ) => Promise<string>,
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const guild = interaction.guild;
      if (!guild) {
        throw new ModerationError("This command can only be used in a server.");
      }

      const moderator = getModeratorMember(interaction);
      const target = await resolveGuildMember(guild, userId);
      assertCanModerate(guild, moderator, target);

      const message = await action(guild, moderator, target);
      await interaction.editReply(message);
    } catch (error) {
      log.warn({ err: error }, "Moderation command failed");
      await interaction.editReply(formatActionError(error));
    }
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minute(s)`;
  }

  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours}h ${remainder}m` : `${hours} hour(s)`;
  }

  const days = Math.floor(minutes / (24 * 60));
  const remainderHours = Math.floor((minutes % (24 * 60)) / 60);
  return remainderHours > 0 ? `${days}d ${remainderHours}h` : `${days} day(s)`;
}
