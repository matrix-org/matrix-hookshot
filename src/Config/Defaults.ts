import { BridgeConfig } from "./Config";
import YAML from "yaml";
import { getConfigKeyMetadata, keyIsHidden } from "./Decorators";
import { Node, YAMLSeq } from "yaml/types";
import { randomBytes } from "crypto";
import { DefaultDisallowedIpRanges } from "matrix-appservice-bridge";

export const DefaultConfig = new BridgeConfig({
    bridge: {
        domain: "example.com",
        url: "http://localhost:8008",
        mediaUrl: "http://example.com",
        port: 9993,
        bindAddress: "127.0.0.1", 
    },
    queue: {
        monolithic: true,
        port: 6379,
        host: "localhost",
    },
    logging: {
        level: "info",
        colorize: true,
        json: false,
        timestampFormat: "HH:mm:ss:SSS",
    },
    permissions: [{
        actor: "example.com",
        services: [{
            service: "*",
            level: "admin"
        }],
    }],
    passFile: "passkey.pem",
    widgets: {
        publicUrl: "http://example.com/widgetapi/v1/static",
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
        displayname: "GitHub Bot",
        avatar: "mxc://half-shot.uk/2876e89ccade4cb615e210c458e2a7a6883fe17d"
    },
    github: {
        auth: {
            id: 123,
            privateKeyFile: "github-key.pem",
        },
        oauth: {
            client_id: "foo",
            client_secret: "bar",
            redirect_uri: "https://example.com/bridge_oauth/",
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
            publicUrl: "https://example.com/hookshot/"
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
            redirect_uri: "https://example.com/bridge_oauth/",
        },
    },
    generic: {
        allowJsTransformationFunctions: false,
        enabled: false,
        enableHttpGet: false,
        urlPrefix: "https://example.com/webhook/",
        userIdPrefix: "_webhooks_",
        waitForComplete: false,
    },
    figma: {
        publicUrl: "https://example.com/hookshot/",
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
    encryption: {
        storagePath: "./data/encryption"
    }
}, {});

function renderSection(doc: YAML.Document, obj: Record<string, unknown>, parentNode?: YAMLSeq) {
    const entries = Object.entries(obj);
    entries.forEach(([key, value]) => {
        if (keyIsHidden(obj, key)) {
            return;
        }

        let newNode: Node;
        if (typeof value === "object" && !Array.isArray(value)) {
            newNode = YAML.createNode({});
            renderSection(doc, value as Record<string, unknown>, newNode as YAMLSeq);
        } else if (typeof value === "function") {
            if (value.length !== 0) {
                throw Error("Only zero-argument functions are allowed as config values");
            }
            newNode = YAML.createNode(value());
        } else {
            newNode = YAML.createNode(value);
        }

        const metadata = getConfigKeyMetadata(obj, key);
        if (metadata) {
            newNode.commentBefore = `${metadata[1] ? ' (Optional)' : ''} ${metadata[0]}\n`;
        }

        if (parentNode) {
            parentNode.add({key, value: newNode});
        } else {
            doc.add({key, value: newNode});
        }
    })
}

function renderDefaultConfig() {
    const doc = new YAML.Document();
    doc.contents = YAML.createNode({});
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
