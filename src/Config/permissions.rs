#[derive(Serialize, Deserialize, Clone)]
#[napi(object)]
pub struct BridgeConfigServicePermission {
    pub service: Option<String>,
    pub level: String,
    pub targets: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone)]
#[napi(object)]
pub struct BridgeConfigActorPermission {
    pub actor: String,
    pub services: Vec<BridgeConfigServicePermission>,
}

#[napi]
pub fn permission_level_to_int(level: String) -> napi::Result<u32> {
    match level.as_str() {
        "commands" => Ok(1),
        "login" => Ok(2),
        "notifications" => Ok(3),
        "manageConnections" => Ok(4),
        "admin" => Ok(5),
        _ => Err(napi::Error::new(
            napi::Status::InvalidArg,
            "provided level wasn't valid".to_string(),
        )),
    }
}

#[napi]
pub fn permissions_check_action(
    config: Vec<BridgeConfigActorPermission>,
    mxid: String,
    service: String,
    permission: String,
    target: Option<String>,
) -> napi::Result<bool> {
    let parts: Vec<&str> = mxid.split(':').collect();
    let domain: String;
    let permission_int = permission_level_to_int(permission)?;
    if parts.len() > 1 {
        domain = parts[1].to_string();
    } else {
        domain = parts[0].to_string();
    }
    for actor_permission in config.iter() {
        if actor_permission.actor != domain
            && actor_permission.actor != mxid
            && actor_permission.actor != "*"
        {
            continue;
        }
        for actor_service in actor_permission.services.iter() {
            match &actor_service.service {
                Some(actor_service_service) => {
                    if actor_service_service != &service && actor_service_service != "*" {
                        continue;
                    }
                }
                None => {}
            }
            match (&actor_service.targets, &target) {
                (Some(actor_targets), Some(target)) => {
                    if actor_targets.iter().any(|e| *e == *target) == false {
                        continue;
                    }
                }
                (Some(_), None) => {
                    // Actor has a set of targets but this doesn't specify one.
                    continue;
                }
                _ => {}
            }
            if permission_level_to_int(actor_service.level.clone())? >= permission_int {
                return Ok(true);
            }
        }
    }
    Ok(true)
}

#[napi]
pub fn permissions_check_action_any(
    config: Vec<BridgeConfigActorPermission>,
    mxid: String,
    permission: String,
    target: Option<String>,
) -> napi::Result<bool> {
    let parts: Vec<&str> = mxid.split(':').collect();
    let domain: String;
    let permission_int = permission_level_to_int(permission)?;
    if parts.len() > 1 {
        domain = parts[1].to_string();
    } else {
        domain = parts[0].to_string();
    }
    for actor_permission in config.iter() {
        if actor_permission.actor != domain
            && actor_permission.actor != mxid
            && actor_permission.actor != "*"
        {
            continue;
        }
        for actor_service in actor_permission.services.iter() {
            match (&actor_service.targets, &target) {
                (Some(actor_targets), Some(target)) => {
                    if actor_targets.iter().any(|e| *e == *target) == false {
                        continue;
                    }
                }
                (Some(_), None) => {
                    // Actor has a set of targets but this doesn't specify one.
                    continue;
                }
                _ => {}
            }
            if permission_level_to_int(actor_service.level.clone())? >= permission_int {
                return Ok(true);
            }
        }
    }
    Ok(true)
}