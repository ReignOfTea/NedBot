import type { CommandInteraction } from "discord.js";
import { Discord, Guard, Slash } from "discordx";

import { AllowedGuildOnly } from "./guards.js";

@Discord()
@Guard(AllowedGuildOnly)
export class CoreCommands {
  @Slash({ description: "Check bot response time", name: "ping" })
  async ping(interaction: CommandInteraction): Promise<void> {
    const started = Date.now();
    await interaction.reply({ content: "ping" });
    const ms = Date.now() - started;
    await interaction.editReply(`ping — ${ms}ms`);
  }
}
