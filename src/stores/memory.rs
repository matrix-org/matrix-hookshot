use std::collections::{HashMap, HashSet};
use crate::stores::traits::StorageProvider;

pub struct MemoryStorageProvider {
    guids: HashMap<String, HashSet<String>>,
}

impl MemoryStorageProvider {
    pub fn new() -> Self {
        MemoryStorageProvider {
            guids: HashMap::new(),
        }
    }
}

impl StorageProvider for MemoryStorageProvider {
    async fn store_feed_guids(&mut self, url: &String, guids: &Vec<String>) -> Result<(), Err<String>> {
        let mut guid_set = self.guids.get(url).or_else(|| {
            let new = HashSet::new();
            self.guids.insert(url.clone(), new);
            Some(&new)
        }).unwrap();
        for guid in guids {
            guid_set.insert(guid.clone());
        }
        Ok(())
    }

    async fn has_seen_feed(&self, url: &String, guids: &Vec<String>) -> Result<bool, Err<String>> {
        Ok(self.guids.contains_key(url))
    }

    async fn has_seen_feed_guids(&self,url: &String, guids: &Vec<String>) -> Result<Vec<String>, Err<String>> {
        let mut seen_guids = Vec::default();
        if let Some(existing_guids) = self.guids.get(url) {
            for guid in guids {
                if existing_guids.contains(guid) {
                    seen_guids.push(guid.clone());
                }
            }
        }
        Ok(seen_guids)
    }
}