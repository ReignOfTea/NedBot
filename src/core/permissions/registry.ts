/** Known permission keys. Groups like `core` or wildcards like `youtube.*` grant every key under that prefix. */
export const PERMISSION_CATALOG: Readonly<Record<string, string>> = {
  core: "All core commands",
  admin: "All admin commands",
  youtube: "All /youtube commands",
  rss: "All /rss commands",
  x: "All /x commands",
  audit: "All /audit commands",
  roles: "All /roles commands",
  mod: "All /mod commands",

  "core.ping": "Use /ping",

  "admin.restart": "Restart the bot (/restart)",
  "admin.update": "Pull git updates and rebuild (/update)",
  "admin.eval": "Run server JavaScript (/eval)",
  "admin.db": "SQLite database shell (/db)",
  "admin.status": "View bot health (/status)",
  "admin.*": "All admin commands",

  "youtube.subscribe": "Subscribe YouTube channels",
  "youtube.set-channels": "Change YouTube alert channels",
  "youtube.unsubscribe": "Unsubscribe YouTube channels",
  "youtube.ping-add": "Add YouTube subscription pings",
  "youtube.ping-remove": "Remove YouTube subscription pings",
  "youtube.ping-clear": "Clear YouTube subscription pings",
  "youtube.list": "List YouTube subscriptions",
  "youtube.sync": "Force YouTube sync",
  "youtube.*": "All /youtube commands",

  "rss.subscribe": "Subscribe RSS feeds",
  "rss.unsubscribe": "Unsubscribe RSS feeds",
  "rss.set-regex": "Change RSS match regex",
  "rss.test": "Test RSS feed matching",
  "rss.list": "List RSS subscriptions",
  "rss.backfill": "Backfill RSS alerts",
  "rss.sync": "Force RSS sync",
  "rss.ping-add": "Add RSS subscription pings",
  "rss.ping-remove": "Remove RSS subscription pings",
  "rss.ping-clear": "Clear RSS subscription pings",
  "rss.*": "All /rss commands",

  "x.subscribe": "Subscribe X accounts",
  "x.unsubscribe": "Unsubscribe X accounts",
  "x.ping-add": "Add X subscription pings",
  "x.ping-remove": "Remove X subscription pings",
  "x.ping-clear": "Clear X subscription pings",
  "x.list": "List X subscriptions",
  "x.status": "View X alerter status",
  "x.*": "All /x commands",

  "audit.set-channel": "Set audit log channel",
  "audit.enable": "Enable audit logging",
  "audit.disable": "Disable audit logging",
  "audit.clear": "Clear audit log channel",
  "audit.status": "View audit log status",
  "audit.categories": "List audit categories",
  "audit.exclude": "Exclude audit category",
  "audit.include": "Include audit category",
  "audit.reset-filters": "Reset audit filters",
  "audit.*": "All /audit commands",

  "roles.setup": "Create role request panel",
  "roles.add": "Add role to panel",
  "roles.edit": "Edit panel role button",
  "roles.remove": "Remove role from panel",
  "roles.refresh": "Refresh role request panel",
  "roles.list": "List panel roles",
  "roles.*": "All /roles commands",

  "mod.kick": "Kick members",
  "mod.ban": "Ban members",
  "mod.unban": "Unban users",
  "mod.timeout": "Timeout members",
  "mod.untimeout": "Remove member timeouts",
  "mod.warn": "Warn members",
  "mod.warnings": "List member warnings",
  "mod.delwarn": "Delete a warning",
  "mod.clearwarns": "Clear all warnings for a member",
  "mod.purge": "Bulk-delete channel messages",
  "mod.*": "All /mod commands",
};

export const PERMISSION_KEYS = Object.keys(PERMISSION_CATALOG).sort();

export const PERMISSION_CATALOG_GROUPS = [
  "core",
  "admin",
  "youtube",
  "rss",
  "x",
  "audit",
  "roles",
  "mod",
] as const;

export type PermissionCatalogGroup = (typeof PERMISSION_CATALOG_GROUPS)[number];

export function isPermissionCatalogGroup(
  value: string,
): value is PermissionCatalogGroup {
  return (PERMISSION_CATALOG_GROUPS as readonly string[]).includes(value);
}

export function listPermissionKeysForGroup(
  group: PermissionCatalogGroup,
): string[] {
  return PERMISSION_KEYS.filter(
    (key) =>
      key.startsWith(`${group}.`) &&
      !key.endsWith(".*"),
  );
}

const DISCORD_MESSAGE_LIMIT = 2000;

export function formatPermissionCatalogOverview(): string {
  const wildcards = PERMISSION_KEYS.filter((key) => key.endsWith(".*"));
  return [
    "**Permission catalog**",
    "",
    "Grant a **group** (`core`, `mod`, `youtube`, …) to cover all commands in that module.",
    "You can also use wildcards like `mod.*` or individual keys like `mod.kick`.",
    "",
    "**Groups**",
    PERMISSION_CATALOG_GROUPS.map(
      (group) => `- \`${group}\` — ${PERMISSION_CATALOG[group]}`,
    ).join("\n"),
    "",
    "**Wildcards**",
    wildcards.map((key) => `- \`${key}\` — ${PERMISSION_CATALOG[key]}`).join("\n"),
    "",
    "Use `/perms catalog group:<name>` to list every key in a section.",
  ].join("\n");
}

export function formatPermissionCatalogGroup(group: PermissionCatalogGroup): string {
  const keys = listPermissionKeysForGroup(group);
  const lines = keys.map((key) => {
    const label = PERMISSION_CATALOG[key];
    return `- \`${key}\`${label ? ` — ${label}` : ""}`;
  });

  return [`**${group}** permissions`, ...lines].join("\n");
}

/** Split text into Discord-safe message chunks. */
export function chunkDiscordMessages(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

export function normalizePermissionKey(key: string): string {
  return key.trim().toLowerCase();
}

export function isKnownPermission(key: string): boolean {
  const normalized = normalizePermissionKey(key);
  return normalized in PERMISSION_CATALOG;
}

/** Whether a key can be granted/revoked (groups, wildcards, or individual commands). */
export function isGrantablePermission(key: string): boolean {
  const normalized = normalizePermissionKey(key);
  return isPermissionCatalogGroup(normalized) || normalized in PERMISSION_CATALOG;
}

import type { CommandInteraction } from "discord.js";

/** Maps top-level slash commands to permission keys. */
const TOP_LEVEL_PERMISSIONS: Record<string, string> = {
  ping: "core.ping",
  restart: "admin.restart",
  update: "admin.update",
  eval: "admin.eval",
  db: "admin.db",
  status: "admin.status",
};

export function resolveCommandPermission(
  interaction: CommandInteraction,
): string {
  if (!interaction.isChatInputCommand()) {
    return interaction.commandName;
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);

  if (sub) {
    const prefix = group ?? interaction.commandName;
    return `${prefix}.${sub}`;
  }

  return TOP_LEVEL_PERMISSIONS[interaction.commandName] ?? interaction.commandName;
}
