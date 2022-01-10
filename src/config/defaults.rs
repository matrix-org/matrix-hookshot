use std::collections::HashMap;
use serde::Serialize;
use super::config::{*};

#[derive(Serialize, Deserialize, Clone)]
pub struct DefaultBridgeConfigItem<T: Serialize + Clone> {
    pub comment: String,
    pub v: T,
}

pub struct DefaultBridgeConfig {
    pub bot: DefaultBridgeConfigItem<BridgeConfigBot>,
    pub bridge: DefaultBridgeConfigItem<BridgeConfigBridge>,
    pub listeners: DefaultBridgeConfigItem<Vec<BridgeConfigListener>>,
    pub logging: DefaultBridgeConfigItem<BridgeConfigLogging>,
    pub queue: DefaultBridgeConfigItem<BridgeConfigMessageQueue>,
    pub passFile: DefaultBridgeConfigItem<String>,
}

pub fn comment_multiline(comment: &String) -> String {
    let mut sentences = Vec::new();
    let mut out = String::new();
    let mut len = 0;
    for word in comment.split(' ') {
        if len > 0 {
            out.push_str(" ");
            len += 1;
        }
        out.push_str(word);
        len += word.len();
        if len >= 70 {
            sentences.push(out);
            out = String::new();
            out.push_str("\n# ");
            len = 0;
        }
    }
    ,
    out
}

#[cfg(test)]
mod tests {
    use crate::config::defaults::comment_multiline;
    #[test]
    fn comment_multiline_simple() {
      assert_eq!(
          comment_multiline(
            &"A small sentence".to_string()),
            "\n# A small sentence"
        );
    }

    #[test]
    fn comment_multiline_multiline() {
      assert_eq!(
          comment_multiline(
            &"A small sentence with lots of words that will need to be split up right here".to_string()),
            "\n# A small sentence with lots of words that will need to be split up right\n# here"
        );
    }
}

impl DefaultBridgeConfig {
    pub fn new() -> Self {
        DefaultBridgeConfig {
            bot: DefaultBridgeConfigItem {
                comment: "Define profile information for the bot user".to_string(),
                v: BridgeConfigBot {
                    displayname: Some("Hookshot Bot".to_string()),
                    avatar: Some("mxc://half-shot.uk/2876e89ccade4cb615e210c458e2a7a6883fe17d".to_string())
                }
            },
            bridge: DefaultBridgeConfigItem {
                comment: "Basic homeserver configuration".to_string(),
                v: BridgeConfigBridge {
                    domain: "example.com".to_string(),
                    port: 1234,
                    bind_address: "127.0.0.1".to_string(),
                    media_url: Some("https://example-media-repo.com".to_string()),
                    url: "https://example.com".to_string(),
                }
            },
            listeners: DefaultBridgeConfigItem {
                comment: indoc! {"
                    HTTP Listener configuration.
                    Bind resource endpoints to ports and addresses.
                    'resources' may be any of webhooks, widgets, metrics, provisioning
                "}.to_string(),
                // TODO: Fill me in
                v: vec![]
            },
            logging: DefaultBridgeConfigItem {
                comment: "Logging settings. You can have a severity debug,info,warn,error".to_string(),
                v: BridgeConfigLogging {
                    level: "info".to_string(),
                }
            }, 
            queue: DefaultBridgeConfigItem {
                comment: "Message queue / cache configuration options for large scale deployments".to_string(),
                v: BridgeConfigMessageQueue {
                    monolithic: true,
                    port: Some(6379),
                    host: Some("localhost".to_string()),
                }
            },
            passFile: DefaultBridgeConfigItem {
                comment: indoc! {"
                A passkey used to encrypt tokens stored inside the bridge.
                Run openssl genpkey -out passkey.pem -outform PEM -algorithm RSA -pkeyopt rsa_keygen_bits:4096 to generate
                "}.to_string(),
                v: "passkey.pem".to_string()
            },
        }
    }

    fn to_output<T: Serialize + Clone>(name: String, item: &DefaultBridgeConfigItem<T>) -> String {
        let mut output = String::new();
        output.push_str(&comment_multiline(&item.comment));
        let mut map = HashMap::new();
        map.insert(name, item.v.clone());
        let yaml = serde_yaml::to_string(&map).unwrap();
        output.push_str(yaml.strip_prefix("---").unwrap());
        return output;
    }

    pub fn output(&self) -> String {
        let mut output = String::new();
        output.push_str(&DefaultBridgeConfig::to_output("bot".to_string(),&self.bot));
        output.push_str(&DefaultBridgeConfig::to_output("bridge".to_string(),&self.bridge));
        output.push_str(&DefaultBridgeConfig::to_output("listeners".to_string(),&self.listeners));
        output.push_str(&DefaultBridgeConfig::to_output("logging".to_string(),&self.logging));
        output.push_str(&DefaultBridgeConfig::to_output("queue".to_string(),&self.queue));
        output
    }
}

impl From<DefaultBridgeConfig> for BridgeConfig {
    fn from(d: DefaultBridgeConfig) -> Self {
        BridgeConfig {
            bot: Some(d.bot.v),
            bridge: d.bridge.v,
            logging: d.logging.v,
            queue: Some(d.queue.v),
            listeners: d.listeners.v,
            passFile: d.passFile.v,
        }
    }
}
