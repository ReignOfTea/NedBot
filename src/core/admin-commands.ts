import {
  ApplicationCommandOptionType,
  type CommandInteraction,
} from "discord.js";
import { Discord, Guard, Slash, SlashChoice, SlashOption } from "discordx";

import { bot } from "./bot.js";
import { createDbShell, KNOWN_DB_TABLES, type DbShellRowOptions } from "./db-shell.js";
import { AdministratorOnly, AllowedGuildOnly } from "./guards.js";
import { editEphemeral, DeferEphemeral } from "./interactions.js";
import { requestRestart } from "./lifecycle.js";
import { getModuleContext } from "./module-loader.js";

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
@Guard(AllowedGuildOnly, AdministratorOnly)
export class AdminCommands {
  @Slash({ description: "Restart the bot process", name: "restart" })
  @Guard(DeferEphemeral)
  async restart(interaction: CommandInteraction): Promise<void> {
    await editEphemeral(
      interaction,
      "Restarting bot…",
    );

    void requestRestart(`discord:${interaction.user.id}`);
  }

  @Slash({
    description: "Run JavaScript on the server and return the result",
    name: "eval",
  })
  @Guard(DeferEphemeral)
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
  @Guard(DeferEphemeral)
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
