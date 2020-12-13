import { BridgeConfig } from "./Config";
import YAML from "yaml";
import { getConfigKeyMetadata } from "./Decorators";
import { Node, YAMLSeq } from "yaml/types";

const DefaultConfig = new BridgeConfig({
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
        installationId: 6854059,
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
    }
}, {});

function renderSection(doc: YAML.Document, obj: Record<string, unknown>, parentNode?: YAMLSeq) {
    const entries = Object.entries(obj);
    entries.forEach(([key, value], i) => {
        let newNode: Node;
        if (typeof value === "object") {
            newNode = doc.createNode({});
            renderSection(doc, value as any, newNode as YAMLSeq);
        } else {
            newNode = doc.createNode(value);
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
    const doc = new YAML.Document({});
    doc.commentBefore = ' This is an example configuration file';
    // Needed because the entries syntax below would not work otherwise
    //const typeLessDefaultConfig = DefaultConfig as any;
    renderSection(doc, DefaultConfig as any);
    return doc.toString();
}

// Can be called directly
console.log(renderDefaultConfig())