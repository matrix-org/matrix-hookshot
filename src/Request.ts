import { setRequestFn } from "matrix-bot-sdk";
import type { OptionsWithUri, RequestResponse } from "request";
import { Agent } from "undici";

let installed = false;

/**
 * Install a request function for the bot-sdk that uses "fetch" and a dedicated
 * agent to achieve more performance.
 */
export function installRequestFunction() {
    if (installed) {
        return;
    }
    const dispatcher = new Agent({ allowH2: true, keepAliveTimeout: 1000, pipelining: 8 });
    const fn = async (params: OptionsWithUri): Promise<{response: RequestResponse, rBody: Buffer|unknown}> => {
        let url = params.uri.toString();
        if (params.qs) {
            url += `?${new URLSearchParams(params.qs).toString()}`
        }
        const abort = new AbortController();
        const tOut = params.timeout !== undefined ? setTimeout(() => abort.abort("Timed out"), params.timeout): undefined;
        const res = await fetch(url, {
            method: params.method ?? 'GET',
            body: params.body,
            headers: params.headers,
            keepalive: true,
            dispatcher,
            signal: tOut ? abort.signal : undefined,
        } satisfies Partial<RequestInit>);
        clearTimeout(tOut);
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
        } as Partial<RequestResponse> as any};
    };
    setRequestFn(
        (params: OptionsWithUri, callback: (err: Error|null, response?: any, rBody?: any) => void) => 
        fn(params).then(({response, rBody}) => callback(null, response, rBody)).catch(callback)
    );
    installed = true;
}
