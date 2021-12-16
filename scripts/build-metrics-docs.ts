/* eslint-disable no-console */
import Metrics from "../src/Metrics";
import { register } from "prom-client";

// This is just used to ensure we create a singleton.
Metrics.getMetrics();

const anyRegister = register as any;

const categories: {[title: string]: {name: string, labels: string[], help: string}[]} = {};

Object.entries(anyRegister._metrics as {[metricName: string]: {labelNames: string[], name: string, help: string}}).map(
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

Below is the generated list of prometheus metrics for hookshot.
`)

Object.entries(categories).forEach(([name, entries]) => {
    console.log(`## ${name}`);
    console.log('| Metric | Help | Labels |');
    console.log('|--------|------|--------|');
    entries.forEach((e) => console.log(`| ${e.name} | ${e.help} | ${e.labels.join(', ')} |`));
});
