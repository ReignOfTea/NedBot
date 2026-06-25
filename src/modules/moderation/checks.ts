import {
  GuildMember,
  PermissionFlagsBits,
  type CommandInteraction,
  type Guild,
} from "discord.js";

export class ModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModerationError";
  }
}

const PERMISSION_LABELS: Partial<Record<keyof typeof PermissionFlagsBits, string>> = {
  KickMembers: "Kick Members",
  BanMembers: "Ban Members",
  ModerateMembers: "Moderate Members",
  ManageMessages: "Manage Messages",
};

export function getModeratorMember(interaction: CommandInteraction): GuildMember {
  if (
    !interaction.guild ||
    !interaction.member ||
    !(interaction.member instanceof GuildMember)
  ) {
    throw new ModerationError("This command can only be used in a server.");
  }

  return interaction.member;
}

export async function resolveGuildMember(
  guild: Guild,
  userId: string,
): Promise<GuildMember> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    throw new ModerationError("That user is not in this server.");
  }
  return member;
}

export function assertCanModerate(
  guild: Guild,
  moderator: GuildMember,
  target: GuildMember,
): void {
  if (target.id === moderator.id) {
    throw new ModerationError("You cannot moderate yourself.");
  }

  if (target.id === guild.ownerId) {
    throw new ModerationError("You cannot moderate the server owner.");
  }

  if (target.id === guild.client.user?.id) {
    throw new ModerationError("You cannot moderate the bot.");
  }

  if (moderator.roles.highest.position <= target.roles.highest.position) {
    throw new ModerationError(
      "You cannot moderate a member with an equal or higher role.",
    );
  }

  const me = guild.members.me;
  if (!me) {
    throw new ModerationError("Bot member is not available.");
  }

  if (me.roles.highest.position <= target.roles.highest.position) {
    throw new ModerationError(
      "I cannot moderate this member — their highest role is above mine.",
    );
  }
}

export function assertBotHasPermission(
  guild: Guild,
  permission: bigint,
): void {
  const me = guild.members.me;
  if (!me?.permissions.has(permission)) {
    const label =
      Object.entries(PermissionFlagsBits).find(([, value]) => value === permission)?.[0] ??
      "required";
    const readable =
      PERMISSION_LABELS[label as keyof typeof PermissionFlagsBits] ?? label;
    throw new ModerationError(`I am missing the **${readable}** permission.`);
  }
}

export function formatReason(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "No reason provided";
}

export function reasonSuffix(reason: string | null | undefined): string {
  return `\n**Reason:** ${formatReason(reason)}`;
}

export function formatActionError(error: unknown): string {
  if (error instanceof ModerationError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Moderation action failed.";
}
