use std::collections::HashMap;
use super::types::*;
use redis::{Client, Commands};

pub struct RedisMQ<'a> {
    client: Client,
    pubsub: redis::PubSub<'a>,
    once_callbacks: HashMap<String, Vec<Callback>>,
    push_callbacks: HashMap<String, Vec<Callback>>,
}

impl RedisMQ<'_> {
    fn new(url: Option<String>) -> Self {
        let client = Client::open(
            url.unwrap_or(String::from("redis://localhost:6379"))
        ).unwrap();
        let pubsub = client.get_connection().unwrap().as_pubsub();
        RedisMQ {
            client: client,
            once_callbacks: HashMap::new(),
            push_callbacks: HashMap::new(),
            pubsub: pubsub,
        }
    }
}

impl MessageQueue for RedisMQ<'_> {
    fn subscribe(&mut self, event_glob: String) -> Result<bool, glob::PatternError> {
        // Impl removePartsFromEventName?
        self.pubsub.subscribe(event_glob).unwrap();
        return Ok(true);
    }

    fn unsubscribe(&mut self, event_glob: String) -> Result<bool, glob::PatternError> {
        todo!()
    }

    fn on(&mut self, event_name: String, callback: Callback) {
        todo!()
    }

    fn once(&mut self, event_name: String, callback: Callback) {
        todo!()
    }

    fn push(&mut self, message: MessageQueueMessage) {
        // TODO: Resultify
        let event = message.clone();
        let _ : () = self.client.publish(
            message.event_name, 
            serde_json::to_string(&event).unwrap()
        ).unwrap();
    }
}