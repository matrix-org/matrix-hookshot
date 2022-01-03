use super::config::{*};

pub struct DefaultBridgeConfigItem<T> {
    pub comment: String,
    pub v: T,
}

pub struct DefaultBridgeConfig {
    pub bot: DefaultBridgeConfigItem<BridgeConfigBot>,
    pub bridge: DefaultBridgeConfigItem<BridgeConfigBridge>,
    pub listeners: DefaultBridgeConfigItem<Vec<BridgeConfigListener>>,
    pub logging: DefaultBridgeConfigItem<BridgeConfigLogging>,
    pub queue: DefaultBridgeConfigItem<BridgeConfigMessageQueue>,
}

impl DefaultBridgeConfig {
    pub fn new() -> Self {
        DefaultBridgeConfig {
            bot: DefaultBridgeConfigItem {
                comment: "foo".to_string(),
                v: BridgeConfigBot {
                    displayname: Some("Hookshot Bot".to_string()),
                    avatar: Some("mxc://example.com/foobar".to_string())
                }
            },
            bridge: DefaultBridgeConfigItem {
                comment: "ffoo".to_string(),
                v: BridgeConfigBridge {

                }
            },
            listeners: DefaultBridgeConfigItem {
                comment: "ffoo".to_string(),
                v: vec![BridgeConfigListener { }]
            },
            logging: DefaultBridgeConfigItem {
                comment: "fooo".to_string(),
                v: BridgeConfigLogging {
                    level: "info".to_string(),
                }
            }, 
            queue: DefaultBridgeConfigItem {
                comment: "fooo".to_string(),
                v: BridgeConfigMessageQueue {
                    monolithic: true,
                    port: Some(6379),
                    host: Some("localhost".to_string()),
                }
            }
        }
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
        }
    }
}
