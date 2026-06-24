const IMAGE_URL_PATTERN = /^https?:\/\/.+/i;

const BUTTON_STYLE_ANCHORS = [
  { style: 1 as const, r: 0x58, g: 0x65, b: 0xf2 }, // Primary (blurple)
  { style: 2 as const, r: 0x4f, g: 0x54, b: 0x5c }, // Secondary (grey)
  { style: 3 as const, r: 0x57, g: 0xf2, b: 0x87 }, // Success (green)
  { style: 4 as const, r: 0xed, g: 0x42, b: 0x45 }, // Danger (red)
] as const;

export type DiscordButtonStyle = (typeof BUTTON_STYLE_ANCHORS)[number]["style"];

/**
 * Discord buttons only support preset styles — pick the closest match to a hex color.
 */
export function colorToButtonStyle(color: number): DiscordButtonStyle {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;

  if (saturation < 0.12) {
    return 2;
  }

  let bestStyle: DiscordButtonStyle = 1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const anchor of BUTTON_STYLE_ANCHORS) {
    const distance =
      (r - anchor.r) ** 2 + (g - anchor.g) ** 2 + (b - anchor.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStyle = anchor.style;
    }
  }

  return bestStyle;
}

export function parseEmbedColor(
  input: string | undefined,
  fallback: number,
): number | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    throw new Error("Color must be a 6-digit hex value, e.g. `#5865F2`.");
  }

  return Number.parseInt(trimmed, 16);
}

export function resolveEmbedColor(
  configured: number | null | undefined,
  roleColor: number,
  fallback = 0x5865f2,
): number {
  if (configured != null && configured > 0) {
    return configured;
  }

  if (roleColor > 0) {
    return roleColor;
  }

  return fallback;
}

export function validateImageUrl(input: string | undefined): string | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!IMAGE_URL_PATTERN.test(trimmed)) {
    throw new Error("Image must be an http(s) URL.");
  }

  if (trimmed.length > 2048) {
    throw new Error("Image URL is too long.");
  }

  return trimmed;
}
