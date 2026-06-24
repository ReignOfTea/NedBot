import type { RssFeedItem, RssMatchField } from "./types.js";

export function compileMatchRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid regex: ${message}`);
  }
}

export function itemMatchesRegex(
  item: RssFeedItem,
  regex: RegExp,
  fields: RssMatchField[],
): boolean {
  const text = fields
    .map((field) => fieldValue(item, field))
    .filter((value) => value.length > 0)
    .join("\n");

  return regex.test(text);
}

function fieldValue(item: RssFeedItem, field: RssMatchField): string {
  switch (field) {
    case "title":
      return item.title;
    case "summary":
    case "description":
    case "content":
      return item.summary;
    default:
      return "";
  }
}

export function getNewEntries(
  items: RssFeedItem[],
  lastEntryId: string | null,
): RssFeedItem[] {
  if (items.length === 0) {
    return [];
  }

  if (!lastEntryId) {
    return [...items].reverse();
  }

  const newItems: RssFeedItem[] = [];
  for (const item of items) {
    if (item.id === lastEntryId) {
      break;
    }
    newItems.push(item);
  }

  return newItems.reverse();
}
