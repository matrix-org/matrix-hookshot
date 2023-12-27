/* eslint-disable no-console */
import Metrics from "../src/Metrics";
import { register } from "prom-client";

// This is just used to ensure we create a singleton.
Metrics.getMetrics();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyRegister = register as any as {_metrics: {[metricName: string]: {labelNames: string[], name: string, help: string}}};

const categories: {[title: string]: {name: string, labels: string[], help: string}[]} = {};

Object.entries(anyRegister._metrics).map(
    ([key, value]) => {
        const [categoryName] = key.split('_');
        categories[categoryName] = categories[categoryName] || [];
        categories[categoryName].push({
            name: key,
            labels: value.labelNames,
            help: value.help,
        });
    });

// Generate some markdown

console.log(`Prometheus Metrics
==================

You can configure metrics support by adding the following to your config:

\`\`\`yaml
metrics:
  enabled: true
  bindAddress: 127.0.0.1
  port: 9002
\`\`\`

Hookshot will then provide metrics on \`127.0.0.1\` at port \`9002\`.

An example dashboard that can be used with [Grafana](https://grafana.com) can be found at [/contrib/hookshot-dashboard.json](https://github.com/matrix-org/matrix-hookshot/blob/main/contrib/hookshot-dashboard.json).
There are 3 variables at the top of the dashboard:

![image](https://user-images.githubusercontent.com/2803622/179366574-1bb83e30-05c6-4558-9e66-e813e85b3a6e.png)

Select the Prometheus instance with your Hookshot metrics as Data Source. Set Interval to your scraping interval. Set 2x Interval to twice the Interval value ([why?](https://github.com/matrix-org/matrix-hookshot/pull/407#issuecomment-1186251618)).

Below is the generated list of Prometheus metrics for Hookshot.

`)

Object.entries(categories).forEach(([name, entries]) => {
    console.log(`## ${name}`);
    console.log('| Metric | Help | Labels |');
    console.log('|--------|------|--------|');
    entries.forEach((e) => console.log(`| ${e.name} | ${e.help} | ${e.labels.join(', ')} |`));
});
