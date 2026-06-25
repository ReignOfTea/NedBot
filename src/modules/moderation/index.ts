import { registerModule } from "../../core/module-loader.js";
import type { BotModule, ModuleContext } from "../../core/types.js";

const moderationModule: BotModule = {
  id: "moderation",
  name: "Moderation",
  description: "Kick, ban, timeout, warn, and purge commands",

  initialize(ctx: ModuleContext) {
    ctx.log.info("Ready");
  },
};

registerModule({
  id: moderationModule.id,
  name: moderationModule.name,
  description: moderationModule.description,
  enabled: true,
  create: () => moderationModule,
});

import "./commands.js";
