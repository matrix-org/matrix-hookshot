use std::collections::{HashMap, HashSet};

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
struct BridgePermissions {
    config: Vec<BridgeConfigActorPermission>,
    room_membership: HashMap<String, HashSet<String>>,
}

#[napi]
impl BridgePermissions {
    #[napi(constructor)]
    pub fn new(config: Vec<BridgeConfigActorPermission>) -> Self {
        let mut room_membership = HashMap::new();
        for entry in config.iter() {
            if entry.actor.starts_with('!') {
                room_membership.insert(entry.actor.clone(), HashSet::new());
            }
        }
        BridgePermissions {
            config,
            room_membership,
        }
    }

    fn match_actor(
        &self,
        actor_permission: &BridgeConfigActorPermission,
        domain: &String,
        mxid: &String,
    ) -> bool {
        if actor_permission.actor.starts_with('!') {
            match self.room_membership.get(&actor_permission.actor) {
                Some(set) => {
                    return set.contains(mxid);
                }
                None => {
                    // No cached data stored...odd.
                    return false;
                }
            }
        }
        actor_permission.actor.eq(domain)
            || actor_permission.actor.eq(mxid)
            || actor_permission.actor == "*"
    }

    #[napi]
    pub fn get_interested_rooms(&self) -> Vec<String> {
        self.room_membership.keys().cloned().collect()
    }

    #[napi]
    pub fn add_member_to_cache(&mut self, room_id: String, mxid: String) {
        if let Some(set) = self.room_membership.get_mut(&room_id) {
            set.insert(mxid);
        }
    }

    #[napi]
    pub fn remove_member_from_cache(&mut self, room_id: String, mxid: String) {
        if let Some(set) = self.room_membership.get_mut(&room_id) {
            set.remove(&mxid);
        }
    }

    #[napi]
    pub fn check_action(
        &self,
        mxid: String,
        service: String,
        permission: String,
    ) -> napi::Result<bool> {
        let parts: Vec<&str> = mxid.split(':').collect();
        let permission_int = permission_level_to_int(permission)?;
        let domain = if parts.len() > 1 {
            parts[1].to_string()
        } else {
            parts[0].to_string()
        };
        for actor_permission in self.config.iter() {
            // Room_id
            if !self.match_actor(actor_permission, &domain, &mxid) {
                continue;
            }
            for actor_service in actor_permission.services.iter() {
                if let Some(actor_service_service) = &actor_service.service {
                    if actor_service_service != &service && actor_service_service != "*" {
                        continue;
                    }
                }
                if permission_level_to_int(actor_service.level.clone())? >= permission_int {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    #[napi]
    pub fn check_action_any(&self, mxid: String, permission: String) -> napi::Result<bool> {
        let parts: Vec<&str> = mxid.split(':').collect();
        let permission_int = permission_level_to_int(permission)?;
        let domain = if parts.len() > 1 {
            parts[1].to_string()
        } else {
            parts[0].to_string()
        };
        for actor_permission in self.config.iter() {
            if !self.match_actor(actor_permission, &domain, &mxid) {
                continue;
            }
            for actor_service in actor_permission.services.iter() {
                if permission_level_to_int(actor_service.level.clone())? >= permission_int {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
}
