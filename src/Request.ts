import { setRequestFn } from "matrix-bot-sdk";
import type { OptionsWithUri, RequestResponse } from "request";
import { Agent, fetch as undiciFetch, RequestInit as UndiciRequestInit } from "undici";

const globalAgent = new Agent({ allowH2: true });

/**
 * Implements the required functionality to be a "request"-like function for matrix-bot-sdk.
 * Supports concurrent requests via HTTP/2.
 *
 * @param params Parameters for the request
 * @returns A promise that returns with a response and pre-parsed body.
 */
async function doRequest(params: OptionsWithUri): Promise<{response: RequestResponse, rBody: Buffer|unknown}> {
    let url = params.uri.toString();
    if (params.qs) {
        url += `?${new URLSearchParams(params.qs).toString()}`
    }
    const abort = new AbortController();
    const tOut = params.timeout !== undefined ? setTimeout(() => abort.abort("Timed out"), params.timeout): undefined;
    let res;
    try {
        res = await undiciFetch(url, {
            method: params.method ?? 'GET',
            body: params.body,
            headers: params.headers,
            keepalive: true,
            dispatcher: globalAgent,
            signal: tOut ? abort.signal : undefined,
        } satisfies Partial<UndiciRequestInit>);
    } catch (ex) {
        if (ex instanceof Error && ex.cause) {
            throw ex.cause;
        }
        throw ex;
    } finally {
        clearTimeout(tOut);
    }

    let rBody: Buffer|unknown;
    if (res.headers.get('Content-Type') === 'application/json') {
        rBody = await res.json();
    } else{
        rBody = Buffer.from(await res.arrayBuffer());
    }
    // We don't return an entirely compatible "request" response
    // as we barely use any of it. This covers the usage of the bot-sdk
    // today.
    return { rBody, response: {
        body: rBody,
        headers: Object.fromEntries(res.headers.entries()),
        statusCode: res.status,
        statusMessage: res.statusText,
    // Use any as we aren't returning a "true" reqeust response.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } satisfies Partial<RequestResponse> as any};
}

/**
 * Install a request function for the bot-sdk that uses "fetch" and a dedicated
 * agent to achieve more performance.
 */
export function installRequestFunction() {
    setRequestFn(
        (params: OptionsWithUri, callback: (err: Error|null, response?: unknown, rBody?: unknown) => void) => 
        doRequest(params).then(({response, rBody}) => callback(null, response, rBody)).catch(callback)
    );
}
