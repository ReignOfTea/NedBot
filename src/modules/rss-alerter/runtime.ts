import type { RssPoller } from "./poller.js";

let poller: RssPoller | null = null;

export function getRssPoller(): RssPoller | null {
  return poller;
}

export function setRssPoller(next: RssPoller | null): void {
  poller = next;
}
