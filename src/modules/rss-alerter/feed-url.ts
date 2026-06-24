export function normalizeFeedUrl(url: string): string {
  const trimmed = url.trim();
  const parsed = new URL(trimmed);
  parsed.hash = "";
  return parsed.toString();
}

export function validateFeedUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Feed URL must be a valid http(s) URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Feed URL must use http or https");
  }

  return normalizeFeedUrl(parsed.toString());
}
