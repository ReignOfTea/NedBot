import "dotenv/config";

export interface AppConfig {
  botToken: string;
  youtubeApiKey: string;
  databasePath: string;
  youtubePollIntervalMs: number;
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
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const xAuthToken = process.env.X_AUTH_TOKEN?.trim() || null;
  const xCt0 = process.env.X_CT0?.trim() || null;

  return {
    botToken: requireEnv("BOT_TOKEN"),
    youtubeApiKey: requireEnv("YOUTUBE_API_KEY"),
    databasePath: process.env.DATABASE_PATH ?? "./data/ned-bot.db",
    youtubePollIntervalMs:
      Number(process.env.YOUTUBE_POLL_INTERVAL_SECONDS ?? 120) * 1000,
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
  };
}
