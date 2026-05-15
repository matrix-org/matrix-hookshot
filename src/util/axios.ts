import { AxiosHeaderValue } from "axios";

/**
 * Get a string from a header value.
 * @returns A string if the header is a string, else undefined.
 */
export function getStringHeader(header?: AxiosHeaderValue): string | undefined {
  if (!header) {
    return undefined;
  }
  if (typeof header !== "string") {
    return undefined;
  }
  return header;
}
