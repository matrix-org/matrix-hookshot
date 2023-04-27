import { Appservice, FunctionCallContext, METRIC_MATRIX_CLIENT_FAILED_FUNCTION_CALL, METRIC_MATRIX_CLIENT_SUCCESSFUL_FUNCTION_CALL } from "matrix-bot-sdk";
import { collectDefaultMetrics, Counter, Gauge, register, Registry } from "prom-client";
import { Response, Router } from "express";
import { Logger } from "matrix-appservice-bridge";
const log = new Logger("Metrics");

export class Metrics {
    public readonly expressRouter = Router();

    public readonly webhooksHttpRequest = new Counter({ name: "hookshot_webhooks_http_request", help: "Number of requests made to the hookshot webhooks handler", labelNames: ["path", "method"], registers: [this.registry]});
    public readonly provisioningHttpRequest = new Counter({ name: "hookshot_provisioning_http_request", help: "Number of requests made to the hookshot webhooks handler", labelNames: ["path", "method"], registers: [this.registry]});

    public readonly messageQueuePushes = new Counter({ name: "hookshot_queue_event_pushes", help: "Number of events pushed through the queue", labelNames: ["event"], registers: [this.registry]});
    public readonly connectionsEventFailed = new Counter({ name: "hookshot_connection_event_failed", help: "The number of events that failed to process", labelNames: ["event", "connectionId"], registers: [this.registry]});
    public readonly connections = new Gauge({ name: "hookshot_connections", help: "The number of active hookshot connections", labelNames: ["service"], registers: [this.registry]});

    public readonly notificationsPush = new Counter({ name: "hookshot_notifications_push", help: "Number of notifications pushed", labelNames: ["service"], registers: [this.registry]});
    public readonly notificationsServiceUp = new Gauge({ name: "hookshot_notifications_service_up", help: "Is the notification service up or down", labelNames: ["service"], registers: [this.registry]});
    public readonly notificationsWatchers = new Gauge({ name: "hookshot_notifications_watchers", help: "Number of notifications watchers running", labelNames: ["service"], registers: [this.registry]});

    private readonly matrixApiCalls = new Counter({ name: "matrix_api_calls", help: "The number of Matrix client API calls made", labelNames: ["method"], registers: [this.registry]});
    private readonly matrixApiCallsFailed = new Counter({ name: "matrix_api_calls_failed", help: "The number of Matrix client API calls which failed", labelNames: ["method"], registers: [this.registry]});

    public readonly matrixAppserviceEvents = new Counter({ name: "matrix_appservice_events", help: "The number of events sent over the AS API", labelNames: [], registers: [this.registry]});
    public readonly matrixAppserviceDecryptionFailed = new Counter({ name: "matrix_appservice_decryption_failed", help: "The number of events sent over the AS API that failed to decrypt", registers: [this.registry]});

    public readonly feedsCount = new Gauge({ name: "hookshot_feeds_count", help: "The number of RSS feeds that hookshot is subscribed to", labelNames: [], registers: [this.registry]});
    public readonly feedFetchMs = new Gauge({ name: "hookshot_feeds_fetch_ms", help: "The time taken for hookshot to fetch all feeds", labelNames: [], registers: [this.registry]});
    public readonly feedsFailing = new Gauge({ name: "hookshot_feeds_failing", help: "The number of RSS feeds that hookshot is failing to read", labelNames: ["reason"], registers: [this.registry]});
    public readonly feedsCountDeprecated = new Gauge({ name: "feed_count", help: "(Deprecated) The number of RSS feeds that hookshot is subscribed to", labelNames: [], registers: [this.registry]});
    public readonly feedsFetchMsDeprecated = new Gauge({ name: "feed_fetch_ms", help: "(Deprecated) The time taken for hookshot to fetch all feeds", labelNames: [], registers: [this.registry]});
    public readonly feedsFailingDeprecated = new Gauge({ name: "feed_failing", help: "(Deprecated) The number of RSS feeds that hookshot is failing to read", labelNames: ["reason"], registers: [this.registry]});


    constructor(private registry: Registry = register) {
        this.expressRouter.get('/metrics', this.metricsFunc.bind(this));
        collectDefaultMetrics({
            register: this.registry,
        })
    }

    public async getMetrics() {
        return this.registry.metrics();
    }


    /**
    * Registers some exported metrics that relate to operations of the embedded
    * matrix-js-sdk. In particular, a metric is added that counts the number of
    * calls to client API endpoints made by the client library.
    */
     public registerMatrixSdkMetrics(appservice: Appservice): void {
        appservice.metrics.registerListener({
            onStartMetric: () => {
                // Not used yet.
            },
            onEndMetric: () => {
                // Not used yet.
            },
            onIncrement: (metricName, context) => {
                if (metricName === METRIC_MATRIX_CLIENT_SUCCESSFUL_FUNCTION_CALL) {
                    const ctx = context as FunctionCallContext;
                    this.matrixApiCalls.inc({method: ctx.functionName});
                }
                if (metricName === METRIC_MATRIX_CLIENT_FAILED_FUNCTION_CALL) {
                    const ctx = context as FunctionCallContext;
                    this.matrixApiCallsFailed.inc({method: ctx.functionName});
                }
            },
            onDecrement: () => {
                // Not used yet.
            },
            onReset: (metricName) => {
                if (metricName === METRIC_MATRIX_CLIENT_SUCCESSFUL_FUNCTION_CALL) {
                    this.matrixApiCalls.reset();
                }
                if (metricName === METRIC_MATRIX_CLIENT_FAILED_FUNCTION_CALL) {
                    this.matrixApiCallsFailed.reset();
                }
            },
        })
    }

    private metricsFunc(_req: unknown, res: Response) {
        this.getMetrics().then(
            (m) => res.type('text/plain').send((m))
        ).catch((err) => {
            log.error('Failed to fetch metrics: ', err);
            res.status(500).send('Could not fetch metrics due to an error');
        });
    }
}

const singleton = new Metrics();

export default singleton;
