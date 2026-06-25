/** Known permission keys. Wildcards like `youtube.*` grant every key under that prefix. */
export const PERMISSION_CATALOG: Readonly<Record<string, string>> = {
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
};

export const PERMISSION_KEYS = Object.keys(PERMISSION_CATALOG).sort();

export function isKnownPermission(key: string): boolean {
  return key in PERMISSION_CATALOG;
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
