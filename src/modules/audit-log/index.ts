import { registerModule } from "../../core/module-loader.js";
import type { BotModule, ModuleContext } from "../../core/types.js";
import { AuditLogListener } from "./listeners.js";
import { getAuditLogListener, setAuditLogListener } from "./runtime.js";

const auditLogModule: BotModule = {
  id: "audit-log",
  name: "Audit Log",
  description: "Logs moderation actions to a configured Discord channel",

  initialize(ctx: ModuleContext) {
    const listener = new AuditLogListener(ctx);
    setAuditLogListener(listener);
    listener.start();
  },

  destroy() {
    getAuditLogListener()?.stop();
    setAuditLogListener(null);
  },
};

registerModule({
  id: auditLogModule.id,
  name: auditLogModule.name,
  description: auditLogModule.description,
  enabled: true,
  create: () => auditLogModule,
});

import "./commands.js";
