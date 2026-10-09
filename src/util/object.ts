/**
 * Read a property from an unknown value when it is an object.
 * @returns The property value, or undefined when the value is not an object.
 */
export function safeGet(value: unknown, key: string): unknown {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return undefined;
  }

  return Reflect.get(value, key);
}
