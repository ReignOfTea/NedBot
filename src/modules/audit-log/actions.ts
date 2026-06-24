import { AuditLogEvent } from "discord.js";

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

export function isModerationAction(action: AuditLogEvent): boolean {
  return MODERATION_ACTIONS.has(action);
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
