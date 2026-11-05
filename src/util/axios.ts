import { AxiosHeaderValue } from "axios";

/**
 * Get the HTTP status from an Axios-style error response.
 * @returns The response status if it is a number, else undefined.
 */
export function getAxiosErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return undefined;
  }

  const response = error.response;
  if (
    typeof response !== "object" ||
    response === null ||
    !("status" in response)
  ) {
    return undefined;
  }

  return typeof response.status === "number" ? response.status : undefined;
}

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
