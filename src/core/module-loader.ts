import { dirname, resolve } from "@discordx/importer";
import { DIService, MetadataStorage } from "discordx";

import { bot } from "./bot.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./database.js";
import { coreLog, createModuleLogger } from "./logger.js";
import type { BotModule, ModuleContext, ModuleManifest, SharedModuleContext } from "./types.js";

const moduleManifests: ModuleManifest[] = [];

export function registerModule(manifest: ModuleManifest): void {
  const existing = moduleManifests.findIndex((m) => m.id === manifest.id);
  if (existing >= 0) {
    moduleManifests[existing] = manifest;
    return;
  }
  moduleManifests.push(manifest);
}

export function getRegisteredModules(): readonly ModuleManifest[] {
  return moduleManifests;
}

const activeModules = new Map<string, BotModule>();

let sharedContext: SharedModuleContext | null = null;

export function getModuleContext(): SharedModuleContext {
  if (!sharedContext) {
    const config = loadConfig();
    sharedContext = {
      client: bot,
      config,
      db: createDatabase(config.databasePath),
    };
  }
  return sharedContext;
}

export function resetModuleContext(): void {
  sharedContext?.db.close();
  sharedContext = null;
}

async function loadModuleFiles(pattern: string): Promise<void> {
  const files = await resolve(pattern);
  await Promise.all(
    files.map((file) =>
      import(`${file}?v=${Date.now().toString()}`).catch((error: unknown) => {
        coreLog.error({ err: error, file }, "Failed to import module file");
      }),
    ),
  );
}

export async function initializeModules(
  importPattern: string,
): Promise<SharedModuleContext> {
  await loadModuleFiles(importPattern);

  const ctx = getModuleContext();

  for (const manifest of moduleManifests) {
    if (!manifest.enabled) {
      coreLog.info({ moduleId: manifest.id }, "Skipping disabled module");
      continue;
    }

    if (activeModules.has(manifest.id)) {
      continue;
    }

    const module = await manifest.create();
    const log = createModuleLogger(manifest.id);
    await module.initialize({ ...ctx, log });
    activeModules.set(manifest.id, module);
    log.info({ name: module.name }, "Module loaded");
  }

  await MetadataStorage.instance.build();

  return ctx;
}

export async function syncApplicationCommands(): Promise<void> {
  if (!bot.isReady()) {
    return;
  }
  await bot.initApplicationCommands();
}

export async function reloadModules(importPattern: string): Promise<void> {
  coreLog.info("Reloading modules");

  for (const module of activeModules.values()) {
    await module.destroy?.();
  }
  activeModules.clear();
  moduleManifests.length = 0;

  bot.removeEvents();
  MetadataStorage.clear();
  DIService.engine.clearAllServices();

  await initializeModules(importPattern);
  await syncApplicationCommands();
  bot.initEvents();

  coreLog.info("Module reload complete");
}

export async function shutdownModules(): Promise<void> {
  for (const module of activeModules.values()) {
    await module.destroy?.();
  }
  activeModules.clear();
  resetModuleContext();
}

export function moduleImportPattern(metaUrl: string): string {
  return `${dirname(metaUrl)}/modules/**/!(index).{ts,js}`;
}

export function manifestImportPattern(metaUrl: string): string {
  return `${dirname(metaUrl)}/modules/**/index.{ts,js}`;
}

export function allModuleImportPattern(metaUrl: string): string {
  return `${dirname(metaUrl)}/modules/**/*.{ts,js}`;
}
