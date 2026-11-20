// Example match: @alice:example.org.
const MATRIX_USER_ID_REGEX = /^@[^\s:]+:[^\s:]+$/u;
// Example match: !room:example.org.
const MATRIX_ROOM_ID_REGEX = /^![^\s:]+:[^\s:]+$/u;
// Example match: a value containing a space or newline.
const CONTROL_OR_WHITESPACE_REGEX = /[\p{Cc}\p{White_Space}]/u;

/**
 * Checks whether a value has Matrix user ID form.
 * @example `isMatrixUserId("@alice:example.org")`
 */
export function isMatrixUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    MATRIX_USER_ID_REGEX.test(value) &&
    value.length <= 255
  );
}

/**
 * Checks whether a value is a valid concrete device ID.
 * @example `isMatrixDeviceId("DEVICE123")`
 */
export function isMatrixDeviceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "*" &&
    value.length <= 255 &&
    !CONTROL_OR_WHITESPACE_REGEX.test(value)
  );
}

/**
 * Checks whether a value has Matrix room ID form.
 * @example `isMatrixRoomId("!room:example.org")`
 */
export function isMatrixRoomId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    MATRIX_ROOM_ID_REGEX.test(value) &&
    value.length <= 255
  );
}

/**
 * Checks whether a value has Matrix event ID form.
 * @example `isMatrixEventId("$event123")`
 */
export function isMatrixEventId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("$") &&
    value.length > 1 &&
    value.length <= 255 &&
    !CONTROL_OR_WHITESPACE_REGEX.test(value)
  );
}
