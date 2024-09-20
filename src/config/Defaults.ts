import { BridgeConfig, BridgeConfigRoot } from "./Config";
import { getConfigKeyMetadata, keyIsHidden } from "./Decorators";
import { Node, YAMLSeq, default as YAML } from "yaml";
import { randomBytes } from "crypto";
import { DefaultDisallowedIpRanges } from "matrix-appservice-bridge";

const serverName = "example.com";
const hookshotWebhooksUrl = "https://example.com";

export const DefaultConfigRoot: BridgeConfigRoot = {
    bridge: {
        domain: serverName,
        url: "http://localhost:8008",
        mediaUrl: "https://example.com",
        port: 9993,
        bindAddress: "127.0.0.1",
    },
    queue: {
        redisUri: "redis://localhost:6379",
    },
    cache: {
        redisUri: "redis://localhost:6379",
    },
    logging: {
        level: "info",
        colorize: true,
        json: false,
        timestampFormat: "HH:mm:ss:SSS",
    },
    permissions: [{
        actor: serverName,
        services: [{
            service: "*",
            level: "admin"
        }],
    }],
    passFile: "./passkey.pem",
    widgets: {
        publicUrl: `${hookshotWebhooksUrl}/widgetapi/v1/static`,
        addToAdminRooms: false,
        roomSetupWidget: {
            addOnInvite: false,
        },
        disallowedIpRanges: DefaultDisallowedIpRanges,
        branding: {
            widgetTitle: "Hookshot Configuration"
        },
    },
    bot: {
        displayname: "Hookshot Bot",
        avatar: "mxc://half-shot.uk/2876e89ccade4cb615e210c458e2a7a6883fe17d"
    },
    serviceBots: [
        {
            localpart: "feeds",
            displayname: "Feeds",
            avatar: "./assets/feeds_avatar.png",
            prefix: "!feeds",
            service: "feeds",
        },
    ],
    github: {
        auth: {
            id: 123,
            privateKeyFile: "github-key.pem",
        },
        oauth: {
            client_id: "foo",
            client_secret: "bar",
            redirect_uri: `${hookshotWebhooksUrl}/oauth/`,
        },
        webhook: {
            secret: "secrettoken",
        },
        defaultOptions: {
            showIssueRoomLink: false,
            hotlinkIssues: {
                prefix: "#"
            }
        },
        userIdPrefix: "_github_",
    },
    gitlab: {
        instances: {
            "gitlab.com": {
                url: "https://gitlab.com",
            }
        },
        webhook: {
            secret: "secrettoken",
            publicUrl: `${hookshotWebhooksUrl}/hookshot/`,
        },
        userIdPrefix: "_gitlab_",
    },
    jira: {
        webhook: {
            secret: 'secrettoken'
        },
        oauth: {
            client_id: "foo",
            client_secret: "bar",
            redirect_uri: `${hookshotWebhooksUrl}/oauth/`,
        },
    },
    generic: {
        allowJsTransformationFunctions: false,
        enabled: false,
        enableHttpGet: false,
        urlPrefix: `${hookshotWebhooksUrl}/webhook/`,
        userIdPrefix: "_webhooks_",
        waitForComplete: false,
    },
    figma: {
        publicUrl: `${hookshotWebhooksUrl}/hookshot/`,
        instances: {
            "your-instance": {
                teamId: "your-team-id",
                accessToken: "your-personal-access-token",
                passcode: "your-webhook-passcode",
            }
        }
    },
    feeds: {
        enabled: false,
        pollIntervalSeconds: 600,
        pollTimeoutSeconds: 30,
        pollConcurrency: 4,
    },
    provisioning: {
        secret: "!secretToken"
    },
    metrics: {
        enabled: true,
    },
    listeners: [
        {
            port: 9000,
            bindAddress: '0.0.0.0',
            resources: ['webhooks'],
        },
        {
            port: 9001,
            bindAddress: '127.0.0.1',
            resources: ['metrics', 'provisioning'],
        },
        {
            port: 9002,
            bindAddress: '0.0.0.0',
            resources: ['widgets'],
        }
    ],
    sentry: {
        dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
        environment: "production"
    }
};

export const DefaultConfig = new BridgeConfig(DefaultConfigRoot);

function renderSection(doc: YAML.Document, obj: Record<string, unknown>, parentNode: YAMLSeq|YAML.Document = doc, parentIsOptional = false) {
    const entries = Object.entries(obj);
    entries.forEach(([key, value]) => {
        if (keyIsHidden(obj, key)) {
            return;
        }

        if (value === undefined || value === null) {
            return;
        }

        const [comment, optional] = getConfigKeyMetadata(obj, key) ?? [];
        let newNode: Node;
        if (typeof value === "object" && !Array.isArray(value)) {
            newNode = doc.createNode({});
            renderSection(doc, value as Record<string, unknown>, newNode as YAMLSeq, optional ?? parentIsOptional);
        } else if (typeof value === "function") {
            if (value.length !== 0) {
                throw Error("Only zero-argument functions are allowed as config values");
            }
            newNode = doc.createNode(value());
        } else {
            newNode = doc.createNode(value);
        }
        if (comment) {
            newNode.commentBefore = `${optional ? ' (Optional)' : ''} ${comment}`;
        }
        
        if (optional && !parentIsOptional) {
            const tempDoc = new YAML.Document();
            tempDoc.contents = tempDoc.createNode({});
            tempDoc.add({key, value: newNode});
            // Apply to the parent node after required options
            parentNode.comment = (parentNode.comment || "") + tempDoc.toString() + `\n`;
            return;
        }

        if (optional) {
            parentNode.add({key: key, value: newNode});
        } else if (parentNode) {
            parentNode.add({key, value: newNode});
        }
    })
}

function renderDefaultConfig() {
    const doc = new YAML.Document();
    doc.contents = doc.createNode({});
    doc.commentBefore = ' This is an example configuration file';
    // Needed because the entries syntax below would not work otherwise
    renderSection(doc, DefaultConfig as unknown as Record<string, unknown>);
    return doc.toString();
}


async function renderRegistrationFile(configPath?: string) {
    let bridgeConfig: BridgeConfig;
    if (configPath) {
        bridgeConfig = await BridgeConfig.parseConfig(configPath, process.env);
    } else {
        bridgeConfig = DefaultConfig;
    }
    const obj = {
        as_token: randomBytes(32).toString('hex'),
        hs_token: randomBytes(32).toString('hex'),
        id: 'github-bridge',
        url: `http://${bridgeConfig.bridge.bindAddress}:${bridgeConfig.bridge.port}/`,
        rate_limited: false,
        sender_localpart: 'github',
        namespaces: {
            aliases: [{
                exclusive: true,
                regex: `#github_.+:${bridgeConfig.bridge.domain}`
            },{
                exclusive: true,
                regex: `#gitlab_.+:${bridgeConfig.bridge.domain}`
            }],
            users: [{
                exclusive: true,
                regex: `@_github_.+:${bridgeConfig.bridge.domain}`
            },{
                exclusive: true,
                regex: `@_gitlab_.+:${bridgeConfig.bridge.domain}`
            }],
            rooms: [],
        },
    };
    // eslint-disable-next-line no-console
    console.log(YAML.stringify(obj));
}


// Can be called directly
if (require.main === module) {
    if (process.argv[2] === '--config') {
        // eslint-disable-next-line no-console
        console.log(renderDefaultConfig());
    } else if (process.argv[2] === '--registration') {
        renderRegistrationFile(process.argv[3]).catch(ex => {
            // eslint-disable-next-line no-console
            console.error(ex);
            process.exit(1);
        });
    } else {
        throw Error('Must give --config or --registration');
    }
}
