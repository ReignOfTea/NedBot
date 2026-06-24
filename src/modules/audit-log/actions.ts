import { AuditLogEvent } from "discord.js";

export type AuditCategory =
  | "members"
  | "messages"
  | "roles"
  | "channels"
  | "voice"
  | "automod";

export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  "members",
  "messages",
  "roles",
  "channels",
  "voice",
  "automod",
];

/** Audit log action types treated as moderation for this module. */
export const MODERATION_ACTIONS = new Set<AuditLogEvent>([
  AuditLogEvent.MemberKick,
  AuditLogEvent.MemberPrune,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberBanRemove,
  AuditLogEvent.MemberUpdate,
  AuditLogEvent.MemberRoleUpdate,
  AuditLogEvent.MemberMove,
  AuditLogEvent.MemberDisconnect,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.RoleUpdate,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelOverwriteCreate,
  AuditLogEvent.ChannelOverwriteUpdate,
  AuditLogEvent.ChannelOverwriteDelete,
  AuditLogEvent.MessageDelete,
  AuditLogEvent.MessageBulkDelete,
  AuditLogEvent.MessagePin,
  AuditLogEvent.MessageUnpin,
  AuditLogEvent.ThreadDelete,
  AuditLogEvent.AutoModerationRuleCreate,
  AuditLogEvent.AutoModerationRuleUpdate,
  AuditLogEvent.AutoModerationRuleDelete,
  AuditLogEvent.AutoModerationBlockMessage,
  AuditLogEvent.AutoModerationFlagToChannel,
  AuditLogEvent.AutoModerationUserCommunicationDisabled,
  AuditLogEvent.AutoModerationQuarantineUser,
]);

const CATEGORY_ACTIONS: Record<AuditCategory, readonly AuditLogEvent[]> = {
  members: [
    AuditLogEvent.MemberKick,
    AuditLogEvent.MemberPrune,
    AuditLogEvent.MemberBanAdd,
    AuditLogEvent.MemberBanRemove,
    AuditLogEvent.MemberUpdate,
    AuditLogEvent.MemberRoleUpdate,
  ],
  messages: [
    AuditLogEvent.MessageDelete,
    AuditLogEvent.MessageBulkDelete,
    AuditLogEvent.MessagePin,
    AuditLogEvent.MessageUnpin,
  ],
  roles: [
    AuditLogEvent.RoleCreate,
    AuditLogEvent.RoleUpdate,
    AuditLogEvent.RoleDelete,
  ],
  channels: [
    AuditLogEvent.ChannelDelete,
    AuditLogEvent.ChannelOverwriteCreate,
    AuditLogEvent.ChannelOverwriteUpdate,
    AuditLogEvent.ChannelOverwriteDelete,
    AuditLogEvent.ThreadDelete,
  ],
  voice: [AuditLogEvent.MemberMove, AuditLogEvent.MemberDisconnect],
  automod: [
    AuditLogEvent.AutoModerationRuleCreate,
    AuditLogEvent.AutoModerationRuleUpdate,
    AuditLogEvent.AutoModerationRuleDelete,
    AuditLogEvent.AutoModerationBlockMessage,
    AuditLogEvent.AutoModerationFlagToChannel,
    AuditLogEvent.AutoModerationUserCommunicationDisabled,
    AuditLogEvent.AutoModerationQuarantineUser,
  ],
};

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  members: "Members (kick, ban, timeout, roles)",
  messages: "Messages (delete, pin)",
  roles: "Roles (create, update, delete)",
  channels: "Channels (delete, permissions, threads)",
  voice: "Voice (move, disconnect)",
  automod: "AutoMod",
};

export function isAuditCategory(value: string): value is AuditCategory {
  return (AUDIT_CATEGORIES as readonly string[]).includes(value);
}

export function getActionsForCategory(
  category: AuditCategory,
): readonly AuditLogEvent[] {
  return CATEGORY_ACTIONS[category];
}

export function getCategoryLabel(category: AuditCategory): string {
  return CATEGORY_LABELS[category];
}

export function getCategoryForAction(
  action: AuditLogEvent,
): AuditCategory | null {
  for (const category of AUDIT_CATEGORIES) {
    if (CATEGORY_ACTIONS[category].includes(action)) {
      return category;
    }
  }
  return null;
}

export function isModerationAction(action: AuditLogEvent): boolean {
  return MODERATION_ACTIONS.has(action);
}

export function shouldLogAction(
  action: AuditLogEvent,
  disabledActions: ReadonlySet<AuditLogEvent>,
): boolean {
  return isModerationAction(action) && !disabledActions.has(action);
}

export function actionLabel(action: AuditLogEvent): string {
  return ACTION_LABELS[action] ?? `Action ${action}`;
}

const ACTION_LABELS: Partial<Record<AuditLogEvent, string>> = {
  [AuditLogEvent.MemberKick]: "Member Kicked",
  [AuditLogEvent.MemberPrune]: "Members Pruned",
  [AuditLogEvent.MemberBanAdd]: "Member Banned",
  [AuditLogEvent.MemberBanRemove]: "Member Unbanned",
  [AuditLogEvent.MemberUpdate]: "Member Updated",
  [AuditLogEvent.MemberRoleUpdate]: "Member Roles Updated",
  [AuditLogEvent.MemberMove]: "Member Moved (Voice)",
  [AuditLogEvent.MemberDisconnect]: "Member Disconnected (Voice)",
  [AuditLogEvent.RoleCreate]: "Role Created",
  [AuditLogEvent.RoleUpdate]: "Role Updated",
  [AuditLogEvent.RoleDelete]: "Role Deleted",
  [AuditLogEvent.ChannelDelete]: "Channel Deleted",
  [AuditLogEvent.ChannelOverwriteCreate]: "Channel Permission Added",
  [AuditLogEvent.ChannelOverwriteUpdate]: "Channel Permission Updated",
  [AuditLogEvent.ChannelOverwriteDelete]: "Channel Permission Removed",
  [AuditLogEvent.MessageDelete]: "Message Deleted",
  [AuditLogEvent.MessageBulkDelete]: "Messages Bulk Deleted",
  [AuditLogEvent.MessagePin]: "Message Pinned",
  [AuditLogEvent.MessageUnpin]: "Message Unpinned",
  [AuditLogEvent.ThreadDelete]: "Thread Deleted",
  [AuditLogEvent.AutoModerationRuleCreate]: "AutoMod Rule Created",
  [AuditLogEvent.AutoModerationRuleUpdate]: "AutoMod Rule Updated",
  [AuditLogEvent.AutoModerationRuleDelete]: "AutoMod Rule Deleted",
  [AuditLogEvent.AutoModerationBlockMessage]: "AutoMod Blocked Message",
  [AuditLogEvent.AutoModerationFlagToChannel]: "AutoMod Flagged Message",
  [AuditLogEvent.AutoModerationUserCommunicationDisabled]:
    "AutoMod Timed Out Member",
  [AuditLogEvent.AutoModerationQuarantineUser]: "AutoMod Quarantined Member",
};

export function describeDisabledCategories(
  disabledActions: ReadonlySet<AuditLogEvent>,
): string[] {
  return AUDIT_CATEGORIES.filter((category) =>
    CATEGORY_ACTIONS[category].every((action) => disabledActions.has(action)),
  );
}

export function describePartiallyDisabledCategories(
  disabledActions: ReadonlySet<AuditLogEvent>,
): string[] {
  return AUDIT_CATEGORIES.filter((category) => {
    const actions = CATEGORY_ACTIONS[category];
    const disabledCount = actions.filter((action) =>
      disabledActions.has(action),
    ).length;
    return disabledCount > 0 && disabledCount < actions.length;
  });
}
