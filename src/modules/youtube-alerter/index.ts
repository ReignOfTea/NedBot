import { bot } from "../../core/bot.js";
import { registerModule } from "../../core/module-loader.js";
import type { BotModule, ModuleContext } from "../../core/types.js";
import { YoutubePoller } from "./poller.js";
import { getYoutubePoller, setYoutubePoller } from "./runtime.js";

const youtubeAlerterModule: BotModule = {
  id: "youtube-alerter",
  name: "YouTube Alerter",
  description: "Posts Discord alerts when subscribed YouTube channels go live",

  initialize(ctx: ModuleContext) {
    const poller = new YoutubePoller(
      ctx.db,
      () => bot,
      ctx.config.youtubePollIntervalMs,
      ctx.config.youtubeApiKey,
      ctx.config.discordGuildId,
    );
    setYoutubePoller(poller);
    poller.start();
  },

  destroy() {
    getYoutubePoller()?.stop();
    setYoutubePoller(null);
  },
};

registerModule({
  id: youtubeAlerterModule.id,
  name: youtubeAlerterModule.name,
  description: youtubeAlerterModule.description,
  enabled: true,
  create: () => youtubeAlerterModule,
});

import "./commands.js";
