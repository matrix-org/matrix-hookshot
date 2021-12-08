import { BridgeConfig } from "./Config";
import YAML from "yaml";
import { getConfigKeyMetadata } from "./Decorators";
import { Node, YAMLSeq } from "yaml/types";
import { randomBytes } from "crypto";

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
    },
    passFile: "passkey.pem",
    webhook: {
        port: 9000,
        bindAddress: "0.0.0.0"
    },
    widgets: {
        port: 5000,
        publicUrl: "https://example.com/bridge_widget/",
        addToAdminRooms: true,
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
        }
    },
    gitlab: {
        instances: {
            "gitlab.com": {
                url: "https://gitlab.com",
            }
        },
        webhook: {
            secret: "secrettoken",
        }
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
        enabled: false,
        urlPrefix: "https://example.com/mywebhookspath/",
        allowJsTransformationFunctions: false,
        userIdPrefix: "webhooks_",
    },
    provisioning: {
        bindAddress: "127.0.0.1",
        port: 9001,
        secret: "!secretToken"
    }
}, {});

function renderSection(doc: YAML.Document, obj: Record<string, unknown>, parentNode?: YAMLSeq) {
    const entries = Object.entries(obj);
    entries.forEach(([key, value]) => {
        let newNode: Node;
        if (typeof value === "object" && !Array.isArray(value)) {
            newNode = YAML.createNode({});
            renderSection(doc, value as Record<string, unknown>, newNode as YAMLSeq);
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
    renderSection(doc, DefaultConfig as any);
    return doc.toString();
}


async function renderRegistrationFile(configPath?: string) {
    let bridgeConfig: BridgeConfig;
    if (configPath) {
        bridgeConfig = await BridgeConfig.parseConfig(configPath, process.env);
    } else {
        bridgeConfig = new BridgeConfig(DefaultConfig, process.env);
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
