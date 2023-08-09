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
    htmlErrors.push(`${statusBadge(alert.status, alert.labels.severity)}${alert.labels.alertname}: ${alert.annotations.description} <a href="${alert.generatorURL}">source</a> ${silenceLink(alert, externalURL)}`)
    result = {
        version: 'v2',
        plain: plainErrors.join(`\n\n`),
        html: htmlErrors.join(`<br/>`),
        msgtype: 'm.text'
    };
}
