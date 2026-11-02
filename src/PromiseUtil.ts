import { StatusCodes } from "http-status-codes";
import { safeGet } from "./util/object";

const SLEEP_TIME_MS = 1000;
const EXPONENT_DIVISOR = 20;
const DEFAULT_RETRY = () => true;

type RetryFn = (error: unknown) => boolean | number;

/**
 * Checks errors returned from a Matrix API request, and determines
 * if the error should be retried.
 * @param err An Error object, which may be a MatrixError
 * @returns - `true` if the action should be retried.
 *  - A `number` if the action should be retried with a specific wait period.
 *  - `false` if the action should not be retried..
 */
export function retryMatrixErrorFilter(err: unknown) {
  const statusCode = safeGet(err, "statusCode");
  if (
    typeof statusCode === "number" &&
    statusCode >= 400 &&
    statusCode <= 499
  ) {
    if (statusCode === StatusCodes.TOO_MANY_REQUESTS) {
      const retryAfterMs = safeGet(err, "retryAfterMs");
      return typeof retryAfterMs === "number" ? retryAfterMs : true;
    }
    return false;
  }
  return true;
}

/**
 * Runs a  function, and retries it if the filter function permits it.
 * @param actionFn The action to run
 * @param maxAttempts The number of attempts to make before giving up.
 * @param waitFor The number of milliseconds to wait between attempts. May be overrideb by filterFn.
 * @param filterFn A function that checks the error on failure, and determines if the action should be retried. By default, this retries ALL failures.
 * @returns The result of actionFn
 * @throws If the `maxAttempts` limit is exceeded, or the `filterFn` returns false.
 */
export async function retry<T>(
  actionFn: () => PromiseLike<T>,
  maxAttempts: number,
  waitFor: number = SLEEP_TIME_MS,
  filterFn: RetryFn = DEFAULT_RETRY,
): Promise<T> {
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    try {
      return await actionFn();
    } catch (ex) {
      const shouldRetry = filterFn(ex);
      if (shouldRetry) {
        // If the filter returns a retry ms, use that.
        const timeMs =
          typeof shouldRetry === "number"
            ? //
              shouldRetry
            : Math.pow(waitFor, 1 + attempts / EXPONENT_DIVISOR);
        await new Promise((r) => setTimeout(r, timeMs));
      } else {
        throw ex;
      }
    }
  }
  throw Error("Timed out");
}
