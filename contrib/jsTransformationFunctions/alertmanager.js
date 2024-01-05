/**
 * This is a transformation function for Prometheus Alertmanager webhooks.
 * https://prometheus.io/docs/alerting/latest/configuration/#webhook_config
 *
 * Creates a formatted `m.text` message with plaintext fallback, containing:
 * - alert status and severity
 * - alert name and description
 * - URL to the entity that caused the alert
 * The formatted message also contains a clickable link that silences the alert.
 */

/**
 * @param status resolved or firing
 * @param severity from the labels of the alert
 * @returns colored text rendering of the status and severity
 */
function statusBadge(status, severity) {
    let statusColor;
    if (status === "resolved") {
        return `<font color='green'><b>[RESOLVED]</b></font>`;
    }

    switch(severity) {
        case 'resolved':
        case 'critical':
            return `<font color='red'><b>[FIRING - CRITICAL]</b></font>`;
        case 'warning':
            return `<font color='orange'><b>[FIRING - WARNING]</b></font>`;
        default:
            return `<b>[${status.toUpperCase()}]</b>`;
    }
}

/**
 * @param alert object from the webhook payload
 * @param externalURL from the webhook payload
 * @returns a formatted link that will silence the alert when clicked
 */
function silenceLink(alert, externalURL) {
    filters = []
    for (const [label, val] of Object.entries(alert.labels)) {
        filters.push(encodeURIComponent(`${label}="${val}"`));
    }
    return `<a href="${externalURL}#silences/new?filter={${filters.join(",")}}">silence</a>`;
}

if (!data.alerts) { 
    result = {
        version: 'v2',
        empty: true,
    };
    return;
}

const plainErrors = [];
const htmlErrors = [];
const { externalURL, alerts } = data;

for (const alert of data.alerts) {
    plainErrors.push(`**[${alert.status.toUpperCase()} - ${alert.labels.severity}]** - ${alert.labels.alertname}: ${alert.annotations.description} [source](${alert.generatorURL})`);
    htmlErrors.push(`<p>${statusBadge(alert.status, alert.labels.severity)}</p><p><b>${alert.labels.alertname}</b>: ${alert.annotations.description.replaceAll("\n","<br\>")}</p><p><a href="${alert.generatorURL}">source</a> | ${silenceLink(alert, externalURL)}</p>`)
    result = {
        version: 'v2',
        plain: plainErrors.join(`\n\n`),
        html: htmlErrors.join(`<br/><br/>`),
        msgtype: 'm.text'
    };
}
