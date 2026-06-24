import type { Logger } from "pino";

import type { AppConfig } from "./config.js";
import type { Database } from "./database.js";

/** Shared runtime services available via getModuleContext(). */
export interface SharedModuleContext {
  client: import("discordx").Client;
  config: AppConfig;
  db: Database;
}

/** Passed to module initialize(); includes a scoped logger. */
export interface ModuleContext extends SharedModuleContext {
  log: Logger;
}

export interface BotModule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  initialize(ctx: ModuleContext): Promise<void> | void;
  destroy?(): Promise<void> | void;
}

export type ModuleFactory = () => BotModule | Promise<BotModule>;

export interface ModuleManifest {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  create: ModuleFactory;
}
