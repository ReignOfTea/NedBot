import {
  ApplicationCommandOptionType,
  type CommandInteraction,
} from "discord.js";
import { Discord, Guard, Slash, SlashChoice, SlashOption } from "discordx";

import { bot } from "./bot.js";
import { createDbShell, KNOWN_DB_TABLES, type DbShellRowOptions } from "./db-shell.js";
import { AllowedGuildOnly } from "./guards.js";
import { getGitUpdater } from "./git-updater-runtime.js";
import type { UpdateResult } from "./git-updater.js";
import { DeferEphemeral, editEphemeral } from "./interactions.js";
import { requestRestart } from "./lifecycle.js";
import { getModuleContext } from "./module-loader.js";
import { requirePermission } from "./permissions/index.js";
import { isPm2Managed } from "./restart.js";
import { getYoutubePoller } from "../modules/youtube-alerter/runtime.js";

const DB_ACTIONS = [
  "help",
  "tables",
  "schema",
  "rows",
  "get",
  "insert",
  "update",
  "delete",
  "query",
] as const;

type DbAction = (typeof DB_ACTIONS)[number];

const EVAL_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_LENGTH = 1_800;

const AsyncFunction = Object.getPrototypeOf(async function () {})
  .constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

@Discord()
@Guard(AllowedGuildOnly)
export class AdminCommands {
  @Slash({ description: "Restart the bot process", name: "restart" })
  @Guard(DeferEphemeral, requirePermission("admin.restart"))
  async restart(
    @SlashOption({
      description: "Pull updates and rebuild before restarting",
      name: "update",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    update: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (update) {
      await runManualUpdate(interaction, { restartIfUpToDate: true });
      return;
    }

    await editEphemeral(interaction, "Restarting bot…");
    void requestRestart(`discord:${interaction.user.id}`);
  }

  @Slash({
    description: "Pull git updates, rebuild, and restart",
    name: "update",
  })
  @Guard(DeferEphemeral, requirePermission("admin.update"))
  async update(interaction: CommandInteraction): Promise<void> {
    await runManualUpdate(interaction, { restartIfUpToDate: false });
  }

  @Slash({
    description: "Run JavaScript on the server and return the result",
    name: "eval",
  })
  @Guard(DeferEphemeral, requirePermission("admin.eval"))
  async eval(
    @SlashOption({
      description: "JavaScript to execute (supports await)",
      name: "code",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    code: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      const output = await runEval(code);
      await editEphemeral(interaction, output);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Eval failed.";
      await editEphemeral(interaction, formatEvalOutput(message));
    }
  }

  @Slash({
    description: "Query or modify the SQLite database",
    name: "db",
  })
  @Guard(DeferEphemeral, requirePermission("admin.db"))
  async db(
    @SlashChoice(...DB_ACTIONS)
    @SlashOption({
      description: "Database action",
      name: "action",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    action: DbAction,
    @SlashChoice(...KNOWN_DB_TABLES)
    @SlashOption({
      description: "Table name",
      name: "table",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    table: string | undefined,
    @SlashOption({
      description:
        "JSON payload (where/set/row/key/options/sql). See /db action:help",
      name: "data",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    data: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      const { db } = getModuleContext();
      const dbx = createDbShell(db);
      const result = runDbAction(dbx, action, table, data);
      await editEphemeral(interaction, formatEvalOutput(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database command failed.";
      await editEphemeral(interaction, formatEvalOutput(message));
    }
  }

  @Slash({ description: "Bot health and runtime stats", name: "status" })
  @Guard(DeferEphemeral, requirePermission("admin.status"))
  async status(interaction: CommandInteraction): Promise<void> {
    const { config } = getModuleContext();
    const youtube = getYoutubePoller()?.getStatus();
    const memoryMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    const lines = [
      `**Uptime:** ${formatDuration(process.uptime())}`,
      `**Memory:** ${memoryMb} MiB heap`,
      `**PM2:** ${isPm2Managed() ? "yes" : "no"}`,
      `**Git auto-update:** ${config.gitAutoUpdateEnabled ? `on (${config.gitAutoUpdateIntervalMs / 1000}s)` : "off"}`,
      `**YouTube quota budget:** ${config.youtubeQuotaBudgetPerDay}/day`,
    ];

    if (youtube) {
      lines.push(
        `**YouTube channels:** ${youtube.channelCount}`,
        `**YouTube poll interval:** ${youtube.pollIntervalSeconds}s (~${youtube.unitsPerChannelCheck} units/channel)`,
        `**Community post checks:** ${youtube.communityPostChecksEnabled ? "on" : "off"}`,
      );
      if (youtube.quotaPausedUntil) {
        lines.push(`**YouTube quota paused until:** ${youtube.quotaPausedUntil}`);
      }
    } else {
      lines.push("**YouTube alerter:** not running");
    }

    await editEphemeral(interaction, lines.join("\n"));
  }
}

async function runManualUpdate(
  interaction: CommandInteraction,
  options: { restartIfUpToDate: boolean },
): Promise<void> {
  const updater = getGitUpdater();
  if (!updater) {
    await editEphemeral(interaction, "Git updater is not available.");
    return;
  }

  await editEphemeral(interaction, "Checking for updates…");
  const result = await updater.checkForUpdates();

  if (result.status === "started") {
    await editEphemeral(interaction, "Update in progress — restarting bot…");
    return;
  }

  if (result.status === "up_to_date") {
    if (options.restartIfUpToDate) {
      await editEphemeral(
        interaction,
        "Already up to date. Restarting bot…",
      );
      void requestRestart(`discord:${interaction.user.id}:update`);
      return;
    }

    await editEphemeral(interaction, "Already up to date.");
    return;
  }

  await editEphemeral(interaction, formatUpdateResult(result));
}

function formatUpdateResult(result: UpdateResult): string {
  switch (result.status) {
    case "busy":
      return "An update or restart is already in progress.";
    case "not_git":
      return "This install is not a git repository.";
    case "failed":
      return `Update failed: ${result.message}`;
    default:
      return "Update could not be started.";
  }
}

async function runEval(code: string): Promise<string> {
  const { config, db } = getModuleContext();
  const dbx = createDbShell(db);
  const fn = new AsyncFunction("bot", "db", "dbx", "config", code);

  const result = await Promise.race([
    fn(bot, db, dbx, config),
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Eval timed out after ${EVAL_TIMEOUT_MS / 1000}s`)),
        EVAL_TIMEOUT_MS,
      );
    }),
  ]);

  return formatEvalOutput(result);
}

function runDbAction(
  dbx: ReturnType<typeof createDbShell>,
  action: string,
  table: string | undefined,
  data: string | undefined,
): unknown {
  const payload = parseJsonObject(data);

  switch (action) {
    case "help":
      return dbx.help();
    case "tables":
      return dbx.tables();
    case "schema":
      requireTable(table);
      return dbx.schema(table);
    case "rows":
      requireTable(table);
      return dbx.rows(table, payload as DbShellRowOptions | undefined);
    case "get":
      requireTable(table);
      if (payload === undefined) {
        throw new Error("get requires data (primary key value or JSON object)");
      }
      return dbx.get(table, payload as string | number | Record<string, unknown>);
    case "insert":
      requireTable(table);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("insert requires data as a JSON object");
      }
      return dbx.insert(table, payload as Record<string, unknown>);
    case "update":
      requireTable(table);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error('update requires data like {"where":{},"set":{}}');
      }
      return dbx.update(
        table,
        payload as { where: Record<string, unknown>; set: Record<string, unknown> },
      );
    case "delete":
      requireTable(table);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("delete requires data as a where JSON object");
      }
      return dbx.delete(table, payload as Record<string, unknown>);
    case "query": {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error('query requires data like {"sql":"SELECT ...","params":[]}');
      }
      const { sql, params } = payload as { sql?: string; params?: unknown[] };
      if (!sql) {
        throw new Error("query requires data.sql");
      }
      return dbx.query(sql, params ?? []);
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

function requireTable(table: string | undefined): asserts table is string {
  if (!table) {
    throw new Error("This action requires the table option");
  }
}

function parseJsonObject(data: string | undefined): unknown {
  if (!data?.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(data);
  } catch {
    throw new Error("data must be valid JSON");
  }
}

function formatEvalOutput(value: unknown): string {
  if (value === undefined) {
    return wrapCode("undefined");
  }

  if (value === null) {
    return wrapCode("null");
  }

  if (typeof value === "string") {
    return truncate(wrapCode(value));
  }

  if (value instanceof Error) {
    const text = `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
    return truncate(wrapCode(text));
  }

  try {
    const json = JSON.stringify(
      value,
      (_key, current) =>
        typeof current === "bigint" ? `${current.toString()}n` : current,
      2,
    );
    if (json !== undefined) {
      return truncate(wrapCode(json));
    }
  } catch {
    // Fall through to String().
  }

  return truncate(wrapCode(String(value)));
}

function wrapCode(text: string): string {
  return `\`\`\`\n${text}\n\`\`\``;
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_OUTPUT_LENGTH - 20)}\n… (truncated)\`\`\``;
}

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}
