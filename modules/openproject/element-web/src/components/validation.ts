import { sanitizeHtml } from "@element-hq/element-web-shared-utils";

export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function safeHtml(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const sanitized = sanitizeHtml(value);
    return sanitized || undefined;
  } catch {
    return undefined;
  }
}

export function safeColor(value: unknown): string | undefined {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    return value;
  }
  return undefined;
}
