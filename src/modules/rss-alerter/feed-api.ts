import { XMLParser } from "fast-xml-parser";

import type { RssFeedItem } from "./types.js";

const USER_AGENT =
  "ned-bot/1.0 (+https://github.com/; RSS poller)";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) => name === "entry" || name === "item" || name === "link",
});

export interface ParsedFeed {
  title: string;
  items: RssFeedItem[];
}

export async function fetchFeed(feedUrl: string): Promise<ParsedFeed> {
  const response = await fetch(feedUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Feed request failed (${response.status} ${response.statusText})`);
  }

  const xml = await response.text();
  return parseFeedXml(xml, feedUrl);
}

export function parseFeedXml(xml: string, feedUrl: string): ParsedFeed {
  const doc = xmlParser.parse(xml) as Record<string, unknown>;
  const feed = (doc.feed ?? doc.rss ?? doc["rdf:RDF"]) as
    | Record<string, unknown>
    | undefined;

  if (!feed) {
    throw new Error("Unrecognized feed format");
  }

  if (doc.feed) {
    return parseAtomFeed(feed, feedUrl);
  }

  const channel = (feed.channel ?? feed) as Record<string, unknown>;
  return parseRssChannel(channel, feedUrl);
}

function parseAtomFeed(
  feed: Record<string, unknown>,
  feedUrl: string,
): ParsedFeed {
  const title = textValue(feed.title) || feedUrl;
  const entries = asArray(feed.entry);
  const items = entries
    .map((entry) => parseAtomEntry(entry))
    .filter((item): item is RssFeedItem => item !== null);

  items.sort(compareItemsNewestFirst);
  return { title, items };
}

function parseRssChannel(
  channel: Record<string, unknown>,
  feedUrl: string,
): ParsedFeed {
  const title = textValue(channel.title) || feedUrl;
  const entries = asArray(channel.item);
  const items = entries
    .map((entry) => parseRssItem(entry))
    .filter((item): item is RssFeedItem => item !== null);

  items.sort(compareItemsNewestFirst);
  return { title, items };
}

function parseAtomEntry(entry: unknown): RssFeedItem | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = textValue(record.id) || linkHref(record.link);
  if (!id) {
    return null;
  }

  return {
    id,
    title: decodeHtml(textValue(record.title)),
    link: linkHref(record.link) || id,
    summary: decodeHtml(
      textValue(record.summary) ||
        textValue(record.content) ||
        textValue(record.subtitle),
    ),
    published: textValue(record.published) || textValue(record.updated),
    imageUrl: atomImageUrl(record),
  };
}

function parseRssItem(item: unknown): RssFeedItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const record = item as Record<string, unknown>;
  const link = textValue(record.link);
  const guid = textValue(record.guid);
  const id = guid || link;
  if (!id) {
    return null;
  }

  return {
    id,
    title: decodeHtml(textValue(record.title)),
    link: link || id,
    summary: decodeHtml(
      textValue(record.description) || textValue(record["content:encoded"]),
    ),
    published: textValue(record.pubDate),
    imageUrl: rssImageUrl(record),
  };
}

function atomImageUrl(entry: Record<string, unknown>): string | undefined {
  const enclosure = enclosureHref(entry.link);
  if (enclosure) {
    return enclosure;
  }

  const thumbnail = recordValue(entry.thumbnail);
  if (thumbnail && typeof thumbnail === "object") {
    const url = (thumbnail as Record<string, unknown>)["@_url"];
    if (typeof url === "string" && url.length > 0) {
      return url;
    }
  }

  return undefined;
}

function rssImageUrl(item: Record<string, unknown>): string | undefined {
  const enclosure = recordValue(item.enclosure);
  if (enclosure && typeof enclosure === "object") {
    const url = (enclosure as Record<string, unknown>)["@_url"];
    if (typeof url === "string" && url.length > 0) {
      return url;
    }
  }

  const media = recordValue(item["media:thumbnail"]);
  if (media && typeof media === "object") {
    const url = (media as Record<string, unknown>)["@_url"];
    if (typeof url === "string" && url.length > 0) {
      return url;
    }
  }

  return undefined;
}

function linkHref(value: unknown): string {
  const links = asArray(value);
  for (const link of links) {
    if (!link || typeof link !== "object") {
      continue;
    }

    const record = link as Record<string, unknown>;
    const href = record["@_href"];
    if (typeof href === "string" && href.length > 0) {
      const rel = record["@_rel"];
      if (rel === undefined || rel === "alternate" || rel === "") {
        return href;
      }
    }
  }

  if (typeof value === "string") {
    return value;
  }

  const single = recordValue(value);
  if (single && typeof single === "object") {
    const href = (single as Record<string, unknown>)["@_href"];
    if (typeof href === "string") {
      return href;
    }
  }

  return "";
}

function enclosureHref(value: unknown): string | undefined {
  const links = asArray(value);
  for (const link of links) {
    if (!link || typeof link !== "object") {
      continue;
    }

    const record = link as Record<string, unknown>;
    if (record["@_rel"] === "enclosure") {
      const href = record["@_href"];
      if (typeof href === "string" && href.length > 0) {
        return href;
      }
    }
  }

  return undefined;
}

function compareItemsNewestFirst(a: RssFeedItem, b: RssFeedItem): number {
  const aTime = Date.parse(a.published ?? "") || 0;
  const bTime = Date.parse(b.published ?? "") || 0;
  return bTime - aTime;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function recordValue(value: unknown): unknown {
  if (value && typeof value === "object" && "#text" in value) {
    return value;
  }
  return value;
}

function textValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as Record<string, unknown>)["#text"];
    return typeof text === "string" ? text.trim() : "";
  }

  return "";
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
