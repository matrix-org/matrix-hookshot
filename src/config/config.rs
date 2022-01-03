#[napi(object)]
#[derive(Serialize, Deserialize, Clone)]
pub struct BridgeConfigBot {
    pub displayname: Option<String>,
    pub avatar: Option<String>,
}

#[napi(object)]
#[derive(Serialize, Deserialize, Clone)]
pub struct BridgeConfigBridge {
    pub domain: String,
    pub url: String,
    pub media_url: Option<String>,
    pub port: u32,
    pub bind_address: String,
    // TODO: Ignoring pantalaimon, we'll use encrypted bridges when it lands.
}

#[napi(object)]
#[derive(Serialize, Deserialize, Clone)]
pub struct BridgeConfigLogging {
    pub level: String,
}

#[napi(object)]
#[derive(Serialize, Deserialize)]
pub struct BridgeConfigLoggingYAML {
    pub level: Option<String>,
}

#[napi(object)]
#[derive(Serialize, Deserialize, Clone)]
pub struct BridgeConfigMessageQueue {
    pub monolithic: bool,
    pub port: Option<u32>,
    pub host: Option<String>,
}

#[napi(object)]
#[derive(Serialize, Deserialize, Clone)]
pub struct BridgeConfigListener {
    pub port: u32,
    pub bind_address: Option<String>,
    pub resources: Vec<String>,
}

// Legacy yaml config sections

#[napi(object)]
#[derive(Serialize, Deserialize, Clone)]
pub struct BridgeConfigWebhook {
    pub port: u32,
    pub bind_address: Option<String>,
}

#[napi(object)]
#[derive(Serialize, Deserialize)]
pub struct BridgeConfigYAML {
    pub bot: Option<BridgeConfigBot>,
    pub bridge: BridgeConfigBridge,
    pub listeners: Option<Vec<BridgeConfigListener>>,
    pub logging: Option<BridgeConfigLoggingYAML>,
    pub queue: Option<BridgeConfigMessageQueue>,
    pub webhook: Option<BridgeConfigWebhook>,
}

#[napi]
pub struct BridgeConfig {
    pub bot: Option<BridgeConfigBot>,
    pub bridge: BridgeConfigBridge,
    pub logging: BridgeConfigLogging,
    pub queue: Option<BridgeConfigMessageQueue>,
    pub listeners: Vec<BridgeConfigListener>,
}
