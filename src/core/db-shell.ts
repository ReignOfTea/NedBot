import type { Database } from "./database.js";

const MAX_ROWS = 100;

const TABLE_PRIMARY_KEYS: Record<string, string | string[]> = {
  schema_migrations: "version",
  role_request_panels: "guild_id",
  role_request_panel_roles: "id",
  youtube_subscriptions: "id",
  rss_subscriptions: "id",
  rss_alerted_entries: ["subscription_id", "entry_id"],
  x_subscriptions: "id",
  x_push_state: "id",
  audit_log_settings: "guild_id",
  moderation_warnings: "id",
};

/** Tables exposed in /db slash command choices. */
export const KNOWN_DB_TABLES = Object.keys(TABLE_PRIMARY_KEYS).sort();

export interface DbShellRowOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  where?: Record<string, unknown>;
}

export interface DbShellUpdateInput {
  where: Record<string, unknown>;
  set: Record<string, unknown>;
}

export interface DbShell {
  /** List tables in the database. */
  tables(): string[];
  /** Column definitions for a table. */
  schema(table: string): DbColumnInfo[];
  /** Primary key column(s) for a table. */
  primaryKey(table: string): string | string[];
  /** Select rows with optional filters (max 100). */
  rows(table: string, options?: DbShellRowOptions): unknown[];
  /** Fetch one row by primary key value or composite key object. */
  get(table: string, key: string | number | Record<string, unknown>): unknown | null;
  /** Insert a row and return it (when possible). */
  insert(table: string, row: Record<string, unknown>): unknown;
  /** Update rows matching `where`. */
  update(table: string, input: DbShellUpdateInput): { changes: number };
  /** Delete rows matching `where`. */
  delete(table: string, where: Record<string, unknown>): { changes: number };
  /** Run a read-only SELECT query. */
  query(sql: string, params?: unknown[]): unknown[];
  /** Run INSERT, UPDATE, or DELETE SQL. */
  execute(sql: string, params?: unknown[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
  /** Built-in usage summary. */
  help(): string;
}

export interface DbColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: unknown;
  primaryKey: boolean;
}

export function createDbShell(db: Database): DbShell {
  return {
    tables: () => listTables(db),
    schema: (table) => getSchema(db, table),
    primaryKey: (table) => getPrimaryKey(table),
    rows: (table, options) => selectRows(db, table, options),
    get: (table, key) => getRow(db, table, key),
    insert: (table, row) => insertRow(db, table, row),
    update: (table, input) => updateRows(db, table, input),
    delete: (table, where) => deleteRows(db, table, where),
    query: (sql, params = []) => runSelect(db, sql, params),
    execute: (sql, params = []) => runMutation(db, sql, params),
    help: () => buildHelpText(),
  };
}

function buildHelpText(): string {
  const tables = Object.keys(TABLE_PRIMARY_KEYS).join(", ");
  return [
    "dbx.tables()",
    "dbx.schema('youtube_subscriptions')",
    "dbx.rows('youtube_subscriptions', { limit: 10 })",
    "dbx.rows('youtube_subscriptions', { where: { guild_id: '...' } })",
    "dbx.get('youtube_subscriptions', 1)",
    "dbx.get('role_request_panels', 'guild_id_here')",
    "dbx.insert('youtube_subscriptions', { guild_id, youtube_channel_id, live_channel_id })",
    "dbx.update('youtube_subscriptions', { where: { id: 1 }, set: { last_live_id: null } })",
    "dbx.delete('youtube_subscriptions', { id: 1 })",
    "dbx.query('SELECT COUNT(*) AS n FROM youtube_subscriptions')",
    "",
    `Tables: ${tables}`,
  ].join("\n");
}

function listTables(db: Database): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name ASC`,
    )
    .all() as { name: string }[];

  return rows.map((row) => row.name);
}

function assertKnownTable(db: Database, table: string): string {
  const name = assertIdentifier(table, "table");
  const exists = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(name);

  if (!exists) {
    throw new Error(`Unknown table: ${table}`);
  }

  return name;
}

function assertIdentifier(value: string, kind: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${kind} name: ${value}`);
  }
  return value;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function getPrimaryKey(table: string): string | string[] {
  assertIdentifier(table, "table");
  const primaryKey = TABLE_PRIMARY_KEYS[table];
  if (!primaryKey) {
    throw new Error(`No primary key metadata for table: ${table}`);
  }
  return primaryKey;
}

function getSchema(db: Database, table: string): DbColumnInfo[] {
  const name = assertKnownTable(db, table);
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as {
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }[];

  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    notNull: row.notnull === 1,
    defaultValue: row.dflt_value,
    primaryKey: row.pk > 0,
  }));
}

function getColumnNames(db: Database, table: string): Set<string> {
  return new Set(getSchema(db, table).map((column) => column.name));
}

function buildWhereClause(
  where: Record<string, unknown>,
  columns: Set<string>,
): { clause: string; params: unknown[] } {
  const entries = Object.entries(where);
  if (entries.length === 0) {
    throw new Error("where clause cannot be empty");
  }

  const parts: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of entries) {
    if (!columns.has(key)) {
      throw new Error(`Unknown column: ${key}`);
    }
    parts.push(`${quoteIdent(key)} = ?`);
    params.push(value);
  }

  return { clause: parts.join(" AND "), params };
}

function normalizeKeyForTable(
  table: string,
  key: string | number | Record<string, unknown>,
): Record<string, unknown> {
  if (typeof key === "object" && key !== null) {
    return key;
  }

  const primaryKey = getPrimaryKey(table);
  if (Array.isArray(primaryKey)) {
    throw new Error(
      `Composite primary key requires an object (${primaryKey.join(", ")})`,
    );
  }

  return { [primaryKey]: key };
}

function selectRows(
  db: Database,
  table: string,
  options: DbShellRowOptions = {},
): unknown[] {
  const name = assertKnownTable(db, table);
  const columns = getColumnNames(db, name);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), MAX_ROWS);
  const offset = Math.max(options.offset ?? 0, 0);

  const params: unknown[] = [];
  let sql = `SELECT * FROM ${quoteIdent(name)}`;

  if (options.where) {
    const where = buildWhereClause(options.where, columns);
    sql += ` WHERE ${where.clause}`;
    params.push(...where.params);
  }

  if (options.orderBy) {
    const orderColumn = assertIdentifier(options.orderBy, "column");
    if (!columns.has(orderColumn)) {
      throw new Error(`Unknown column: ${orderColumn}`);
    }
    sql += ` ORDER BY ${quoteIdent(orderColumn)}`;
  }

  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.prepare(sql).all(...params);
}

function getRow(
  db: Database,
  table: string,
  key: string | number | Record<string, unknown>,
): unknown | null {
  const name = assertKnownTable(db, table);
  const columns = getColumnNames(db, name);
  const where = buildWhereClause(normalizeKeyForTable(table, key), columns);
  const sql = `SELECT * FROM ${quoteIdent(name)} WHERE ${where.clause} LIMIT 1`;
  return db.prepare(sql).get(...where.params) ?? null;
}

function insertRow(
  db: Database,
  table: string,
  row: Record<string, unknown>,
): unknown {
  const name = assertKnownTable(db, table);
  const columns = getColumnNames(db, name);
  const entries = Object.entries(row).filter(([column]) => columns.has(column));

  if (entries.length === 0) {
    throw new Error("No valid columns provided for insert");
  }

  const columnNames = entries.map(([column]) => quoteIdent(column));
  const placeholders = entries.map(() => "?");
  const params = entries.map(([, value]) => value);
  const sql = `INSERT INTO ${quoteIdent(name)} (${columnNames.join(", ")}) VALUES (${placeholders.join(", ")})`;

  const result = db.prepare(sql).run(...params);
  const primaryKey = TABLE_PRIMARY_KEYS[name];

  if (typeof primaryKey === "string" && result.lastInsertRowid > 0) {
    return getRow(db, name, Number(result.lastInsertRowid));
  }

  if (Array.isArray(primaryKey)) {
    const key = Object.fromEntries(
      primaryKey
        .filter((column) => row[column] !== undefined)
        .map((column) => [column, row[column]]),
    );
    if (Object.keys(key).length === primaryKey.length) {
      return getRow(db, name, key);
    }
  }

  if (typeof primaryKey === "string" && row[primaryKey] !== undefined) {
    return getRow(db, name, row[primaryKey] as string | number);
  }

  return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
}

function updateRows(
  db: Database,
  table: string,
  input: DbShellUpdateInput,
): { changes: number } {
  const name = assertKnownTable(db, table);
  const columns = getColumnNames(db, name);
  const setEntries = Object.entries(input.set).filter(([column]) =>
    columns.has(column),
  );

  if (setEntries.length === 0) {
    throw new Error("No valid columns provided for update");
  }

  const where = buildWhereClause(input.where, columns);
  const setClause = setEntries
    .map(([column]) => `${quoteIdent(column)} = ?`)
    .join(", ");
  const params = [
    ...setEntries.map(([, value]) => value),
    ...where.params,
  ];
  const sql = `UPDATE ${quoteIdent(name)} SET ${setClause} WHERE ${where.clause}`;
  const result = db.prepare(sql).run(...params);
  return { changes: result.changes };
}

function deleteRows(
  db: Database,
  table: string,
  where: Record<string, unknown>,
): { changes: number } {
  const name = assertKnownTable(db, table);
  const columns = getColumnNames(db, name);
  const clause = buildWhereClause(where, columns);
  const sql = `DELETE FROM ${quoteIdent(name)} WHERE ${clause.clause}`;
  const result = db.prepare(sql).run(...clause.params);
  return { changes: result.changes };
}

function runSelect(db: Database, sql: string, params: unknown[]): unknown[] {
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed)) {
    throw new Error("dbx.query only allows SELECT statements");
  }

  return db.prepare(trimmed).all(...params);
}

function runMutation(
  db: Database,
  sql: string,
  params: unknown[],
): { changes: number; lastInsertRowid: number | bigint } {
  const trimmed = sql.trim();
  if (!/^(insert|update|delete)\b/i.test(trimmed)) {
    throw new Error("dbx.execute only allows INSERT, UPDATE, or DELETE");
  }

  const result = db.prepare(trimmed).run(...params);
  return {
    changes: result.changes,
    lastInsertRowid: result.lastInsertRowid,
  };
}
