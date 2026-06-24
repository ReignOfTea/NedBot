# ned-bot

A modular, pluggable Discord bot built with **TypeScript**, **discordx**, and **SQLite**.

## Features

- **Modular architecture** — drop new modules under `src/modules/`
- **Hot reload** — command and module changes reload in development without restarting
- **Slash commands** — powered by [discordx](https://discordx.js.org) decorators
- **SQLite datastore** — local, zero-config persistence via `better-sqlite3`
- **YouTube Alerter** — first-party module that posts alerts when subscribed channels go live

## Quick start

### 1. Prerequisites

- Node.js 20+

### 2. API keys

Copy `.env.example` to `.env` and fill in the values below.

#### `BOT_TOKEN` — Discord bot token

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, give it a name, and create it.
3. Open **Bot** in the left sidebar → **Reset Token** → copy the token into `BOT_TOKEN` in `.env`.
   - Treat this like a password; never commit it or share it publicly.
4. Under **Privileged Gateway Intents**, you only need **Guilds** enabled (on by default).
5. Open **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: at minimum **Send Messages**, **Embed Links**, and **Use Slash Commands**
6. Copy the generated invite URL, open it in a browser, and add the bot to your server.

Set `DISCORD_GUILD_ID` in `.env` to that server's ID (right-click server → **Copy Server ID**, with Developer Mode enabled). The bot ignores all other servers, and slash commands are registered to this guild only so new commands appear within seconds of a restart.

#### `YOUTUBE_API_KEY` — YouTube Data API v3 key

Required for resolving `@handle` and channel URLs via the YouTube Data API. Live stream polling uses YouTube's public `/live` page and does **not** call `search.list` (which often fails with API-key-only credentials).

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or select an existing one).
3. Go to **APIs & Services → Library**, search for **YouTube Data API v3**, and click **Enable**.
4. Go to **APIs & Services → Credentials → Create Credentials → API key**.
5. Copy the key into `YOUTUBE_API_KEY` in `.env`.
6. (Recommended) Click the new key → **API restrictions** → restrict to **YouTube Data API v3** so it cannot be used for other Google APIs.
7. Under **Application restrictions**, choose **None** (or **IP addresses** if deploying to a fixed server). Avoid HTTP referrer restrictions — those break server-side requests.

If you only subscribe using raw channel IDs (`UC...`), the API key is optional for polling, but still needed for `@handle` / URL resolution.

### 3. Install

```bash
npm install
```

If you have not already, copy `.env.example` to `.env` and add your keys (see [API keys](#2-api-keys) above).

### 4. Run

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

## YouTube Alerter

| Command | Description |
|---------|-------------|
| `/youtube subscribe` | Subscribe a YouTube channel; alerts post to a chosen Discord channel |
| `/youtube unsubscribe` | Remove a subscription |
| `/youtube list` | List subscriptions for the current server |
| `/youtube sync` | Force-check all subscriptions and alert for any live streams (even if already alerted) |
| `/youtube ping-add` | Add a user or role to @mention when a channel goes live |
| `/youtube ping-remove` | Remove a user or role from alerts |
| `/youtube ping-clear` | Clear all ping targets for a subscription |

**Channel input** accepts:

- `https://www.youtube.com/channel/UC...`
- `https://www.youtube.com/@handle`
- `@handle`
- Raw channel ID (`UC...`)

The bot polls YouTube every 2 minutes by default (`YOUTUBE_POLL_INTERVAL_SECONDS`).

## Role Request

Let members self-assign roles via a panel message with toggle buttons.

| Command | Permission | Description |
|---------|------------|-------------|
| `/roles setup` | Manage Roles | Set the panel channel and post the embed |
| `/roles add` | Manage Roles | Add a role pane and button (description, image, color) |
| `/roles edit` | Manage Roles | Update a role pane's description, image, color, or label |
| `/roles remove` | Manage Roles | Remove a role button |
| `/roles refresh` | Manage Roles | Update or repost the panel message |
| `/roles list` | Manage Roles | Show current panel configuration |

**Setup flow:**

1. `/roles setup channel:#role-select title:Pick your roles`
2. `/roles add role:@Gamer description:For gaming nights image:https://... color:#57F287`
3. Members click buttons in the panel to add/remove roles

Each role can have its own **embed pane** with a description, color, and small icon image beside the role name.

The bot needs **Manage Roles** and its role must be **above** any role it assigns. Enable the **Server Members Intent** in the Discord Developer Portal if role toggles fail for uncached members.

## Adding a module

Create `src/modules/my-module/`:

```
my-module/
  index.ts      # registerModule() + lifecycle hooks
  commands.ts   # @Discord() slash command classes (optional)
  service.ts    # background jobs, etc. (optional)
```

**`index.ts` example:**

```typescript
import { registerModule } from "../../core/module-loader.js";
import type { BotModule, ModuleContext } from "../../core/types.js";

const myModule: BotModule = {
  id: "my-module",
  name: "My Module",
  description: "Does something useful",
  initialize(_ctx: ModuleContext) {
    console.log("My module loaded");
  },
  destroy() {
    console.log("My module unloaded");
  },
};

registerModule({
  id: myModule.id,
  name: myModule.name,
  description: myModule.description,
  enabled: true,
  create: () => myModule,
});

import "./commands.js";
```

In development, saving any file under `src/modules/` triggers an automatic reload.

## Project structure

```
src/
  core/
    bot.ts            # discordx client
    config.ts         # environment config
    database.ts       # SQLite schema + queries
    guards.ts         # shared command guards
    module-loader.ts  # plugin registry + hot reload
    types.ts          # BotModule interface
  modules/
    youtube-alerter/  # first module
    role-request/     # self-assignable role panels
  dev.ts              # dev entry (HMR)
  main.ts             # production entry
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BOT_TOKEN` | Yes | — | Discord bot token — [how to get one](#bot_token--discord-bot-token) |
| `DISCORD_GUILD_ID` | Yes | — | Only server the bot responds in; slash commands register here instantly |
| `YOUTUBE_API_KEY` | Yes | — | YouTube Data API v3 key — [how to get one](#youtube_api_key--youtube-data-api-v3-key) |
| `DATABASE_PATH` | No | `./data/ned-bot.db` | SQLite file path |
| `YOUTUBE_POLL_INTERVAL_SECONDS` | No | `120` | Poll interval for live checks |
| `NODE_ENV` | No | `development` | Set to `production` to disable HMR |

## License

MIT
