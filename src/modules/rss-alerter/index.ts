import { bot } from "../../core/bot.js";
import { registerModule } from "../../core/module-loader.js";
import type { BotModule, ModuleContext } from "../../core/types.js";
import { RssPoller } from "./poller.js";
import { getRssPoller, setRssPoller } from "./runtime.js";

const rssAlerterModule: BotModule = {
  id: "rss-alerter",
  name: "RSS Alerter",
  description: "Posts Discord alerts when RSS/Atom feed items match a regex",

  initialize(ctx: ModuleContext) {
    const poller = new RssPoller(
      ctx.db,
      () => bot,
      ctx.config.rssPollIntervalMs,
      ctx.config.discordGuildId,
    );
    setRssPoller(poller);
    poller.start();
  },

  destroy() {
    getRssPoller()?.stop();
    setRssPoller(null);
  },
};

registerModule({
  id: rssAlerterModule.id,
  name: rssAlerterModule.name,
  description: rssAlerterModule.description,
  enabled: true,
  create: () => rssAlerterModule,
});

import "./commands.js";
