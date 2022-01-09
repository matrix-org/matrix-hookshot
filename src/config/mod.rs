use std::fs::File;
use std::collections::HashMap;
use napi::{Error, Status};

use self::config::{*};

pub mod config;
pub mod defaults;


#[napi]
impl BridgeConfig {
  #[napi(factory)]
  pub fn parse_config(filename: String, env: HashMap<String,String>) -> Result<Self, Error> {
    // TODO: Handle these errors better
    let file_result = std::fs::File::open(filename).map_err(|e| {
        Error::new(
            Status::Unknown,
            format!("Error opening config file: {}", e).to_string(),
        )
    });
    let parse_result = match file_result {
        Ok(o) => serde_yaml::from_reader::<File, BridgeConfigYAML>(o).map_err(|e| {
            Error::new(
                Status::Unknown,
                format!("Could not decode YAML from file: {}", e).to_string(),
            )
        }),
        Err(e) => Err(e)
    };
    match parse_result {
        Ok(o) => BridgeConfig::new(o, env),
        Err(e) => Err(e)
    }
  }

  #[napi(constructor)]
  pub fn new(config_yaml: BridgeConfigYAML, env: HashMap<String,String>) -> Result<Self, Error> {
    let logging_yaml = config_yaml.logging.unwrap_or(BridgeConfigLoggingYAML {
      level: Some("info".to_string())
    });
    let mut config = BridgeConfig {
      bot: config_yaml.bot,
      bridge: config_yaml.bridge,
      logging: BridgeConfigLogging {
        level: logging_yaml.level.unwrap_or_else(|| "info".to_string())
      },
      queue: config_yaml.queue,
      listeners: config_yaml.listeners.unwrap_or_else(|| Vec::default())
    };
    match env.get("LOG_LEVEL") {
        Some(log_level) => config.logging.level = log_level.to_string(),
        None => { }
    }
    // Handle legacy 'webhook' config
    match config_yaml.webhook {
    Some(webhook_cfg) => config.listeners.push( BridgeConfigListener {
      bind_address: webhook_cfg.bind_address,
      port: webhook_cfg.port,
      resources: vec!("webhooks".to_string()),
    }),
    None => { }
}
    Ok(config)
  }
}

#[cfg(test)]
mod tests {
    use crate::config::{defaults::DefaultBridgeConfig, config::BridgeConfig};

    #[test]
    fn test_sample_config() {
      let cfg: BridgeConfig = DefaultBridgeConfig::new().into();
      assert_eq!(cfg.logging.level, "info");
    }
}
