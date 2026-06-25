import type { CommandInteraction } from "discord.js";
import { Discord, Guard, Slash } from "discordx";

import { AllowedGuildOnly } from "./guards.js";
import { requirePermission } from "./permissions/index.js";

import "./admin-commands.js";
import "./permission-commands.js";

@Discord()
@Guard(AllowedGuildOnly, requirePermission("core.ping"))
export class CoreCommands {
  @Slash({ description: "Check bot response time", name: "ping" })
  async ping(interaction: CommandInteraction): Promise<void> {
    const started = Date.now();
    await interaction.reply({ content: "Pong!" });
    const ms = Date.now() - started;
    await interaction.editReply(`Pong! ${ms}ms`);
  }
}
