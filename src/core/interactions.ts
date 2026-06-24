import { MessageFlags, type CommandInteraction } from "discord.js";
import type { GuardFunction } from "discordx";

const IGNORABLE_INTERACTION_CODES = new Set([10_062, 40_060]);

export function isIgnorableInteractionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    IGNORABLE_INTERACTION_CODES.has(Number((error as { code: unknown }).code))
  );
}

/** Acknowledge within Discord's 3s window before slow slash-option parsing. */
export const DeferEphemeral: GuardFunction<CommandInteraction> = async (
  interaction,
  _client,
  next,
) => {
  if (
    interaction.isChatInputCommand() &&
    !interaction.deferred &&
    !interaction.replied
  ) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error) {
      if (isIgnorableInteractionError(error)) {
        return;
      }
      throw error;
    }
  }

  await next();
};

export async function editEphemeral(
  interaction: CommandInteraction,
  content: string,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
      return;
    }

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch (error) {
    if (isIgnorableInteractionError(error)) {
      return;
    }
    throw error;
  }
}
