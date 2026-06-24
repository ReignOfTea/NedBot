import type { GuildMember, Role, User } from "discord.js";

export interface PingTarget {
  type: "role" | "user";
  id: string;
}

export function pingTargetFromMentionable(
  target: GuildMember | Role | User,
): PingTarget {
  if ("user" in target && "guild" in target) {
    return { type: "user", id: target.user.id };
  }

  if ("members" in target) {
    return { type: "role", id: target.id };
  }

  return { type: "user", id: target.id };
}

export function describePingTargets(
  roleIds: string[],
  userIds: string[],
): string {
  if (roleIds.length === 0 && userIds.length === 0) {
    return "none";
  }

  return [
    ...roleIds.map((id) => `<@&${id}>`),
    ...userIds.map((id) => `<@${id}>`),
  ].join(", ");
}
