use redis::{Commands, ConnectionInfo};
use crate::stores::traits::StorageProvider;

pub struct RedisStorageProvider {
    client: redis::Client,
}

impl RedisStorageProvider {
    pub fn new(self, host: String, port: u16) -> Self {
        let client = redis::Client::open((host, port))?;

        RedisStorageProvider {
            client,
        }
    }
}

impl StorageProvider for RedisStorageProvider {
    
}