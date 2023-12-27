Prometheus Metrics
==================

You can configure metrics support by adding the following to your config:

```yaml
metrics:
  enabled: true
  bindAddress: 127.0.0.1
  port: 9002
```

Hookshot will then provide metrics on `127.0.0.1` at port `9002`.

An example dashboard that can be used with [Grafana](https://grafana.com) can be found at [/contrib/hookshot-dashboard.json](https://github.com/matrix-org/matrix-hookshot/blob/main/contrib/hookshot-dashboard.json).
There are 3 variables at the top of the dashboard:

![image](https://user-images.githubusercontent.com/2803622/179366574-1bb83e30-05c6-4558-9e66-e813e85b3a6e.png)

Select the Prometheus instance with your Hookshot metrics as Data Source. Set Interval to your scraping interval. Set 2x Interval to twice the Interval value ([why?](https://github.com/matrix-org/matrix-hookshot/pull/407#issuecomment-1186251618)).

Below is the generated list of Prometheus metrics for Hookshot.


## hookshot
| Metric | Help | Labels |
|--------|------|--------|
| hookshot_webhooks_http_request | Number of requests made to the hookshot webhooks handler | path, method |
| hookshot_provisioning_http_request | Number of requests made to the hookshot provisioner handler | path, method |
| hookshot_queue_event_pushes | Number of events pushed through the queue | event |
| hookshot_connection_event_failed | Number of events that failed to process | event, connectionId |
| hookshot_connections | Number of active hookshot connections | service |
| hookshot_notifications_push | Number of notifications pushed | service |
| hookshot_notifications_service_up | Whether the notification service is up or down | service |
| hookshot_notifications_watchers | Number of notifications watchers running | service |
| hookshot_feeds_count | Number of RSS feeds that hookshot is subscribed to |  |
| hookshot_feeds_fetch_ms | Time taken for hookshot to fetch all feeds |  |
| hookshot_feeds_failing | Number of RSS feeds that hookshot is failing to read | reason |
## matrix
| Metric | Help | Labels |
|--------|------|--------|
| matrix_api_calls | Number of Matrix client API calls made | method |
| matrix_api_calls_failed | Number of Matrix client API calls which failed | method |
| matrix_appservice_events | Number of events sent over the AS API |  |
| matrix_appservice_decryption_failed | Number of events sent over the AS API that failed to decrypt |  |
## feed
| Metric | Help | Labels |
|--------|------|--------|
| feed_count | (Deprecated) Number of RSS feeds that hookshot is subscribed to |  |
| feed_fetch_ms | (Deprecated) Time taken for hookshot to fetch all feeds |  |
| feed_failing | (Deprecated) Number of RSS feeds that hookshot is failing to read | reason |
## process
| Metric | Help | Labels |
|--------|------|--------|
| process_cpu_user_seconds_total | Total user CPU time spent in seconds. |  |
| process_cpu_system_seconds_total | Total system CPU time spent in seconds. |  |
| process_cpu_seconds_total | Total user and system CPU time spent in seconds. |  |
| process_start_time_seconds | Start time of the process since unix epoch in seconds. |  |
| process_resident_memory_bytes | Resident memory size in bytes. |  |
| process_virtual_memory_bytes | Virtual memory size in bytes. |  |
| process_heap_bytes | Process heap size in bytes. |  |
| process_open_fds | Number of open file descriptors. |  |
| process_max_fds | Maximum number of open file descriptors. |  |
## nodejs
| Metric | Help | Labels |
|--------|------|--------|
| nodejs_eventloop_lag_seconds | Lag of event loop in seconds. |  |
| nodejs_eventloop_lag_min_seconds | The minimum recorded event loop delay. |  |
| nodejs_eventloop_lag_max_seconds | The maximum recorded event loop delay. |  |
| nodejs_eventloop_lag_mean_seconds | The mean of the recorded event loop delays. |  |
| nodejs_eventloop_lag_stddev_seconds | The standard deviation of the recorded event loop delays. |  |
| nodejs_eventloop_lag_p50_seconds | The 50th percentile of the recorded event loop delays. |  |
| nodejs_eventloop_lag_p90_seconds | The 90th percentile of the recorded event loop delays. |  |
| nodejs_eventloop_lag_p99_seconds | The 99th percentile of the recorded event loop delays. |  |
| nodejs_active_resources | Number of active resources that are currently keeping the event loop alive, grouped by async resource type. | type |
| nodejs_active_resources_total | Total number of active resources. |  |
| nodejs_active_handles | Number of active libuv handles grouped by handle type. Every handle type is C++ class name. | type |
| nodejs_active_handles_total | Total number of active handles. |  |
| nodejs_active_requests | Number of active libuv requests grouped by request type. Every request type is C++ class name. | type |
| nodejs_active_requests_total | Total number of active requests. |  |
| nodejs_heap_size_total_bytes | Process heap size from Node.js in bytes. |  |
| nodejs_heap_size_used_bytes | Process heap size used from Node.js in bytes. |  |
| nodejs_external_memory_bytes | Node.js external memory size in bytes. |  |
| nodejs_heap_space_size_total_bytes | Process heap space size total from Node.js in bytes. | space |
| nodejs_heap_space_size_used_bytes | Process heap space size used from Node.js in bytes. | space |
| nodejs_heap_space_size_available_bytes | Process heap space size available from Node.js in bytes. | space |
| nodejs_version_info | Node.js version info. | version, major, minor, patch |
| nodejs_gc_duration_seconds | Garbage collection duration by kind, one of major, minor, incremental or weakcb. | kind |
