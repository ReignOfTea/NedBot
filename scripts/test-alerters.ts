import "dotenv/config";

import { createClient } from "xnotif";

import { loadConfig } from "../src/core/config.js";
import { createDatabase } from "../src/core/database.js";
import { initLogger, coreLog } from "../src/core/logger.js";
import { loadPushState, savePushState } from "../src/modules/x-alerter/database.js";

initLogger({ isProduction: false });

const X_CONNECT_TIMEOUT_MS = 15_000;

async function testXPush(): Promise<boolean> {
  const config = loadConfig();
  if (!config.xEnabled) {
    coreLog.info("FAIL: X Web Push - X_AUTH_TOKEN or X_CT0 not set");
    return false;
  }

  const db = createDatabase(config.databasePath);
  const savedState = loadPushState(db);

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (ok: boolean, detail: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      client.stop();
      coreLog.info(`${ok ? "PASS" : "FAIL"}: X Web Push - ${detail}`);
      db.close();
      resolve(ok);
    };

    const client = createClient({
      cookies: {
        auth_token: config.xAuthToken!,
        ct0: config.xCt0!,
      },
      state: savedState ?? undefined,
    });

    client.on("connected", (state) => {
      savePushState(db, state);
      finish(true, "Connected to Mozilla Autopush and registered with X");
    });

    client.on("error", (error) => {
      finish(false, `Push client error: ${error.message}`);
    });

    client.on("disconnected", () => {
      finish(false, "Disconnected before connection completed");
    });

    const timer = setTimeout(() => {
      finish(false, `No connection within ${X_CONNECT_TIMEOUT_MS / 1000}s`);
    }, X_CONNECT_TIMEOUT_MS);

    client.start().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      finish(false, `Failed to start: ${message}`);
    });
  });
}

async function main(): Promise<void> {
  coreLog.info("Running X alerter connectivity test");
  const ok = await testXPush();
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  coreLog.error({ err: error }, "Test runner failed");
  process.exit(1);
});
