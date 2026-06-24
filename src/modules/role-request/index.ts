import { registerModule } from "../../core/module-loader.js";
import type { BotModule, ModuleContext } from "../../core/types.js";

const roleRequestModule: BotModule = {
  id: "role-request",
  name: "Role Request",
  description: "Self-assignable role panels with toggle buttons",

  initialize(ctx: ModuleContext) {
    ctx.log.info("Ready");
  },
};

registerModule({
  id: roleRequestModule.id,
  name: roleRequestModule.name,
  description: roleRequestModule.description,
  enabled: true,
  create: () => roleRequestModule,
});

import "./buttons.js";
import "./commands.js";
