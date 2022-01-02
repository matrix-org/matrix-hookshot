#[napi(object)]
#[derive(Serialize, Debug, Deserialize)]
pub struct BridgeConfigLogging {
    pub level: String,
}

#[napi(object)]
#[derive(Serialize, Debug, Deserialize)]
pub struct BridgeConfigLoggingYAML {
    pub level: Option<String>,
}

#[napi(object)]
#[derive(Serialize, Debug, Deserialize)]
pub struct BridgeConfigMessageQueue {
    pub monolithic: bool,
    pub port: Option<u32>,
    pub host: Option<String>,
}


#[napi(object)]
#[derive(Serialize, Debug, Deserialize)]
pub struct BridgeConfig {
    pub logging: BridgeConfigLogging,
}

#[napi(object)]
#[derive(Serialize, Debug, Deserialize)]
pub struct BridgeConfigYAML {
    pub logging: Option<BridgeConfigLoggingYAML>,
    pub queue: Option<BridgeConfigMessageQueue>
}
