import { bot } from "../../core/bot.js";
import { registerModule } from "../../core/module-loader.js";
import type { BotModule, ModuleContext } from "../../core/types.js";
import { log } from "./log.js";
import { XPushListener } from "./push-client.js";
import { getXPushListener, setXPushListener } from "./runtime.js";

const xAlerterModule: BotModule = {
  id: "x-alerter",
  name: "X Alerter",
  description:
    "Posts Discord alerts when subscribed X accounts post (via Web Push)",

  async initialize(ctx: ModuleContext) {
    if (!ctx.config.xEnabled) {
      ctx.log.warn(
        "X alerter disabled — set X_AUTH_TOKEN and X_CT0 in the environment",
      );
      return;
    }

    const pushListener = new XPushListener(
      ctx.db,
      () => bot,
      {
        auth_token: ctx.config.xAuthToken!,
        ct0: ctx.config.xCt0!,
      },
      ctx.config.discordGuildId,
    );

    setXPushListener(pushListener);

    try {
      await pushListener.start();
    } catch (error) {
      setXPushListener(null);
      log.error({ err: error }, "Failed to start X push listener");
      throw error;
    }
  },

  destroy() {
    getXPushListener()?.stop();
    setXPushListener(null);
  },
};

registerModule({
  id: xAlerterModule.id,
  name: xAlerterModule.name,
  description: xAlerterModule.description,
  enabled: true,
  create: () => xAlerterModule,
});

import "./commands.js";
