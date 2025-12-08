// This snippet will receive a webhook containing `text`, e.g. Slack Webhook format and dump it into a codeblock.
// This is useful for hooks which contain monospace-formatted info, for example logs or ZFS event daemon (https://openzfs.github.io/openzfs-docs/man/master/8/zed.8.html) notifications.

result = {
        plain: `\`\`\`\n${data.text}\n\`\`\``,
        version: "v2"
    };
