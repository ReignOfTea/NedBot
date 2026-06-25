import "dotenv/config";

export interface AppConfig {
  botToken: string;
  youtubeApiKey: string;
  databasePath: string;
  youtubeQuotaBudgetPerDay: number;
  rssPollIntervalMs: number;
  isProduction: boolean;
  discordGuildId: string;
  botsChannelId: string;
  xAuthToken: string | null;
  xCt0: string | null;
  xEnabled: boolean;
  gitAutoUpdateEnabled: boolean;
  gitAutoUpdateIntervalMs: number;
  gitRemote: string;
  gitBranch: string;
  youtubeCommunityPostChecksEnabled: boolean;
  botAdminUserIds: readonly string[];
  botOwnerUserId: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseQuotaBudget(raw: string | undefined): number {
  const value = Number(raw ?? 8000);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      "YOUTUBE_QUOTA_BUDGET_PER_DAY must be a positive number",
    );
  }
  return value;
}

function parseBotAdminUserIds(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function getYoutubeQuotaUnitsPerChannelCheck(
  config: Pick<AppConfig, "youtubeCommunityPostChecksEnabled">,
): number {
  let units = 3;
  if (config.youtubeCommunityPostChecksEnabled) {
    units += 1;
  }
  return units;
}

export function loadConfig(): AppConfig {
  const xAuthToken = process.env.X_AUTH_TOKEN?.trim() || null;
  const xCt0 = process.env.X_CT0?.trim() || null;

  return {
    botToken: requireEnv("BOT_TOKEN"),
    youtubeApiKey: requireEnv("YOUTUBE_API_KEY"),
    databasePath: process.env.DATABASE_PATH ?? "./data/ned-bot.db",
    youtubeQuotaBudgetPerDay: parseQuotaBudget(
      process.env.YOUTUBE_QUOTA_BUDGET_PER_DAY,
    ),
    rssPollIntervalMs:
      Number(process.env.RSS_POLL_INTERVAL_SECONDS ?? 300) * 1000,
    isProduction: process.env.NODE_ENV === "production",
    discordGuildId: requireEnv("DISCORD_GUILD_ID"),
    botsChannelId:
      process.env.BOTS_CHANNEL_ID?.trim() || "1519421945324765296",
    xAuthToken,
    xCt0,
    xEnabled: Boolean(xAuthToken && xCt0),
    gitAutoUpdateEnabled: process.env.GIT_AUTO_UPDATE_ENABLED === "true",
    gitAutoUpdateIntervalMs:
      Number(process.env.GIT_AUTO_UPDATE_INTERVAL_SECONDS ?? 300) * 1000,
    gitRemote: process.env.GIT_REMOTE?.trim() || "origin",
    gitBranch: process.env.GIT_BRANCH?.trim() || "master",
    youtubeCommunityPostChecksEnabled:
      process.env.YOUTUBE_COMMUNITY_POST_CHECKS_ENABLED === "true",
    botAdminUserIds: parseBotAdminUserIds(process.env.BOT_ADMIN_USER_IDS),
    botOwnerUserId: process.env.BOT_OWNER_USER_ID?.trim() || null,
  };
}
