import type { GitUpdater } from "./git-updater.js";

let gitUpdater: GitUpdater | null = null;

export function setGitUpdater(updater: GitUpdater): void {
  gitUpdater = updater;
}

export function getGitUpdater(): GitUpdater | null {
  return gitUpdater;
}
