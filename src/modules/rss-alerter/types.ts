export interface RssFeedItem {
  id: string;
  title: string;
  link: string;
  summary: string;
  published?: string;
  imageUrl?: string;
}

export interface RssFeedAlert {
  feedUrl: string;
  feedTitle: string;
  item: RssFeedItem;
}

export const DEFAULT_MATCH_FIELDS = [
  "title",
  "summary",
  "description",
  "content",
] as const;

export type RssMatchField = (typeof DEFAULT_MATCH_FIELDS)[number];
