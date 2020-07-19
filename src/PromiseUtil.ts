import LogWrapper from "./LogWrapper";

const SLEEP_TIME_MS = 250;
const DEFAULT_RETRY = () => true;
const log = new LogWrapper("PromiseUtil");

export async function retry<T>(actionFn: () => Promise<T>,
                               maxAttempts: number,
                               waitFor: number = SLEEP_TIME_MS,
                               filterFn: (err: unknown) => boolean = DEFAULT_RETRY): Promise<T> {
    let attempts = 0;
    while (attempts < maxAttempts) {
        attempts++;
        try {
            return await actionFn();
        } catch (ex) {
            if (filterFn(ex)) {
                const timeMs = waitFor * Math.pow(2, attempts);
                log.warn(`Action failed (${ex}), retrying in ${timeMs}ms`);
                await new Promise((r) => setTimeout(r, timeMs));
            } else {
                throw ex;
            }
        }
    }
    throw Error("Timed out");
}