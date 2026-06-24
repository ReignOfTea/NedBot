import type { YoutubePoller } from "./poller.js";

let poller: YoutubePoller | null = null;

export function setYoutubePoller(instance: YoutubePoller | null): void {
  poller = instance;
}

export function getYoutubePoller(): YoutubePoller | null {
  return poller;
}
