use std::fs::File;
use std::collections::HashMap;
use napi::{Error, Status};

use self::config::{BridgeConfig, BridgeConfigLogging, BridgeConfigYAML, BridgeConfigLoggingYAML};

pub mod config;

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
      logging: BridgeConfigLogging {
        level: logging_yaml.level.unwrap_or("info".to_string())
      }
    };
    match env.get("LOG_LEVEL") {
        Some(log_level) => config.logging.level = log_level.to_string(),
        None => { }
    }
    Ok(config)
  }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::config::config::{BridgeConfig};

    #[test]
    fn it_works() {
      let cfg = BridgeConfig::parse_config("./config.sample.yml".to_string(), HashMap::new()).unwrap();
      assert_eq!(cfg.logging.level, "info");
    }
}
