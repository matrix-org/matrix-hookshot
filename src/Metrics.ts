import { Appservice, FunctionCallContext, METRIC_MATRIX_CLIENT_FAILED_FUNCTION_CALL, METRIC_MATRIX_CLIENT_SUCCESSFUL_FUNCTION_CALL } from "matrix-bot-sdk";
import { collectDefaultMetrics, Counter, Gauge, register, Registry } from "prom-client";
import { Response, Router } from "express";
import { Logger } from "matrix-appservice-bridge";
const log = new Logger("Metrics");

export class Metrics {
    public readonly expressRouter = Router();

    public readonly webhooksHttpRequest;
    public readonly provisioningHttpRequest;

    public readonly messageQueuePushes;
    public readonly connectionsEventFailed;
    public readonly connections;

    public readonly notificationsPush;
    public readonly notificationsServiceUp;
    public readonly notificationsWatchers;

    private readonly matrixApiCalls;
    private readonly matrixApiCallsFailed;

    public readonly matrixAppserviceEvents;
    public readonly matrixAppserviceDecryptionFailed;

    public readonly feedsCount;
    public readonly feedFetchMs;
    public readonly feedsFailing;
    public readonly feedsCountDeprecated;
    public readonly feedsFetchMsDeprecated;
    public readonly feedsFailingDeprecated;


    constructor(private registry: Registry = register) {
        this.expressRouter.get('/metrics', this.metricsFunc.bind(this));

        this.webhooksHttpRequest = new Counter({ name: "hookshot_webhooks_http_request", help: "Number of requests made to the hookshot webhooks handler", labelNames: ["path", "method"], registers: [this.registry]});
        this.provisioningHttpRequest = new Counter({ name: "hookshot_provisioning_http_request", help: "Number of requests made to the hookshot provisioner handler", labelNames: ["path", "method"], registers: [this.registry]});

        this.messageQueuePushes = new Counter({ name: "hookshot_queue_event_pushes", help: "Number of events pushed through the queue", labelNames: ["event"], registers: [this.registry]});
        this.connectionsEventFailed = new Counter({ name: "hookshot_connection_event_failed", help: "Number of events that failed to process", labelNames: ["event", "connectionId"], registers: [this.registry]});
        this.connections = new Gauge({ name: "hookshot_connections", help: "Number of active hookshot connections", labelNames: ["service"], registers: [this.registry]});

        this.notificationsPush = new Counter({ name: "hookshot_notifications_push", help: "Number of notifications pushed", labelNames: ["service"], registers: [this.registry]});
        this.notificationsServiceUp = new Gauge({ name: "hookshot_notifications_service_up", help: "Whether the notification service is up or down", labelNames: ["service"], registers: [this.registry]});
        this.notificationsWatchers = new Gauge({ name: "hookshot_notifications_watchers", help: "Number of notifications watchers running", labelNames: ["service"], registers: [this.registry]});

        this.matrixApiCalls = new Counter({ name: "matrix_api_calls", help: "Number of Matrix client API calls made", labelNames: ["method"], registers: [this.registry]});
        this.matrixApiCallsFailed = new Counter({ name: "matrix_api_calls_failed", help: "Number of Matrix client API calls which failed", labelNames: ["method"], registers: [this.registry]});

        this.matrixAppserviceEvents = new Counter({ name: "matrix_appservice_events", help: "Number of events sent over the AS API", labelNames: [], registers: [this.registry]});
        this.matrixAppserviceDecryptionFailed = new Counter({ name: "matrix_appservice_decryption_failed", help: "Number of events sent over the AS API that failed to decrypt", registers: [this.registry]});

        this.feedsCount = new Gauge({ name: "hookshot_feeds_count", help: "Number of RSS feeds that hookshot is subscribed to", labelNames: [], registers: [this.registry]});
        this.feedFetchMs = new Gauge({ name: "hookshot_feeds_fetch_ms", help: "Time taken for hookshot to fetch all feeds", labelNames: [], registers: [this.registry]});
        this.feedsFailing = new Gauge({ name: "hookshot_feeds_failing", help: "Number of RSS feeds that hookshot is failing to read", labelNames: ["reason"], registers: [this.registry]});
        this.feedsCountDeprecated = new Gauge({ name: "feed_count", help: "(Deprecated) Number of RSS feeds that hookshot is subscribed to", labelNames: [], registers: [this.registry]});
        this.feedsFetchMsDeprecated = new Gauge({ name: "feed_fetch_ms", help: "(Deprecated) Time taken for hookshot to fetch all feeds", labelNames: [], registers: [this.registry]});
        this.feedsFailingDeprecated = new Gauge({ name: "feed_failing", help: "(Deprecated) Number of RSS feeds that hookshot is failing to read", labelNames: ["reason"], registers: [this.registry]});

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
