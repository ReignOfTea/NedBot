import { MessageFlags, type CommandInteraction } from "discord.js";
import type { GuardFunction } from "discordx";

import { coreLog } from "./logger.js";

const IGNORABLE_INTERACTION_CODES = new Set([10_062, 40_060]);

/** Discord message content limit with a small safety buffer. */
export const DISCORD_EPHEMERAL_PAGE_SIZE = 1900;

export function isIgnorableInteractionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    IGNORABLE_INTERACTION_CODES.has(Number((error as { code: unknown }).code))
  );
}

export function isCommandInteraction(value: unknown): value is CommandInteraction {
  return (
    typeof value === "object" &&
    value !== null &&
    "isChatInputCommand" in value &&
    typeof (value as CommandInteraction).isChatInputCommand === "function"
  );
}

/** discordx may pass (optionValues..., interaction, client, data) — find the interaction. */
export function resolveInteraction(...args: unknown[]): CommandInteraction {
  for (let index = args.length - 1; index >= 0; index--) {
    const arg = args[index];
    if (isCommandInteraction(arg)) {
      return arg;
    }
  }

  throw new Error("Could not resolve slash command interaction");
}

/** Split text into Discord-safe message chunks. */
export function chunkDiscordMessages(
  text: string,
  limit = DISCORD_EPHEMERAL_PAGE_SIZE,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= limit) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function formatEphemeralPage(content: string, index: number, total: number): string {
  if (total <= 1) {
    return content;
  }

  const footer = `\n\n— Page ${index + 1}/${total} —`;
  const maxContentLength = DISCORD_EPHEMERAL_PAGE_SIZE - footer.length;
  const body =
    content.length > maxContentLength
      ? `${content.slice(0, maxContentLength - 1)}…`
      : content;

  return `${body}${footer}`;
}

function truncateContent(content: string): string {
  if (content.length <= DISCORD_EPHEMERAL_PAGE_SIZE) {
    return content;
  }

  return `${content.slice(0, DISCORD_EPHEMERAL_PAGE_SIZE - 20)}… (truncated)`;
}

/** Send ephemeral content; single-page replies skip defer to avoid stuck "thinking". */
export async function sendEphemeralContent(
  interaction: CommandInteraction,
  content: string,
): Promise<void> {
  const chunks = chunkDiscordMessages(content);
  if (chunks.length === 0) {
    await editEphemeral(interaction, "(empty response)");
    return;
  }

  const first = formatEphemeralPage(chunks[0]!, 0, chunks.length);

  if (!interaction.deferred && !interaction.replied) {
    if (chunks.length === 1) {
      await interaction.reply({
        content: truncateContent(first),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  await interaction.editReply({ content: truncateContent(first) });

  for (let index = 1; index < chunks.length; index++) {
    await interaction.followUp({
      content: truncateContent(formatEphemeralPage(chunks[index]!, index, chunks.length)),
      flags: MessageFlags.Ephemeral,
    });
  }
}

/** Defer ephemerally, run fn, and always send a reply (or an error). */
export async function runEphemeralCommand(
  interaction: CommandInteraction,
  fn: () => Promise<string> | string,
): Promise<void> {
  try {
    const content = await fn();
    await sendEphemeralContent(interaction, content);
  } catch (error) {
    coreLog.warn({ err: error }, "Ephemeral command failed");
    const message =
      error instanceof Error ? error.message : "Command failed.";

    try {
      await editEphemeral(interaction, message);
    } catch (replyError) {
      coreLog.error(
        { err: replyError, originalErr: error },
        "Failed to send ephemeral error response",
      );
    }
  }
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
      if (!isIgnorableInteractionError(error)) {
        throw error;
      }
    }
  }

  await next();
};

export async function editEphemeral(
  interaction: CommandInteraction,
  content: string,
): Promise<void> {
  const safeContent = truncateContent(content);

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: safeContent });
      return;
    }

    await interaction.reply({
      content: safeContent,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    coreLog.warn({ err: error }, "editEphemeral failed");
    if (isIgnorableInteractionError(error)) {
      return;
    }
    throw error;
  }
}

/** @deprecated Use sendEphemeralContent */
export async function replyEphemeralPaginated(
  interaction: CommandInteraction,
  content: string,
): Promise<void> {
  await sendEphemeralContent(interaction, content);
}
