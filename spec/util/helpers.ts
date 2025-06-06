export async function waitFor(
  condition: () => Promise<boolean>,
  delay = 100,
  maxRetries = 10,
) {
  let retries = 0;
  while (!(await condition()) && retries++ < maxRetries) {
    await new Promise((r) => setTimeout(r, delay));
  }
  if (retries === maxRetries) {
    throw Error("Hit retry limit");
  }
}
