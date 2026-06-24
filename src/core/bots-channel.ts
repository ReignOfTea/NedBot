import type { Client } from "discord.js";

import { coreLog } from "./logger.js";

export async function announceInBotsChannel(
  client: Client,
  guildId: string,
  channelId: string,
  message: string,
): Promise<void> {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);

    if (!channel?.isTextBased()) {
      coreLog.warn(
        { channelId },
        "Bots channel announcement skipped — channel missing or not text-based",
      );
      return;
    }

    await channel.send(message);
  } catch (error) {
    coreLog.warn(
      { err: error, channelId },
      "Failed to post bots channel announcement",
    );
  }
}
