
use glob::PatternError;
use napi::threadsafe_function::ThreadsafeFunction;
use serde_json::Value;
use uuid::Uuid;
use std::time::{SystemTime, UNIX_EPOCH};

pub enum Callback {
    RsCallback(fn(&MessageQueueMessage)),
    JsCallback(ThreadsafeFunction<MessageQueueMessage>),
}

#[derive(Serialize, Deserialize, Clone)]
#[napi(object)]
pub struct MessageQueueMessage {
    pub sender: String,
    pub event_name: String,

    #[napi(ts_type = "unknown")]
    pub data: Value,
    pub id: String,
    pub ts: f64,
    pub destination: Option<String>,
}

#[derive(Deserialize)]
#[napi(object)]
pub struct MessageQueueMessagePushJsPush {
    pub sender: String,
    pub event_name: String,
    pub data: Option<Value>,
    pub id: Option<String>,
    pub ts: Option<f64>,
    pub destination: Option<String>,
}

impl MessageQueueMessage {
    pub fn new(event_name: &str, sender: &str, data: Value) -> Self {
        MessageQueueMessage {
            data,
            destination: None,
            event_name: String::from(event_name),
            id: Uuid::new_v4().to_string(),
            sender: String::from(sender),
            ts:  SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64,
        }
    }

    pub fn with_destination(
        event_name: &str,
        sender: &str,
        data: Value,
        destination: &str,
    ) -> Self {
        MessageQueueMessage {
            data,
            destination: Some(String::from(destination)),
            event_name: String::from(event_name),
            id: Uuid::new_v4().to_string(),
            sender: String::from(sender),
            ts:  SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64,
        }
    }

    pub fn from_js_message(message: MessageQueueMessagePushJsPush) -> Self {
        MessageQueueMessage {
            event_name: message.event_name,
            sender: message.sender,
            data: message.data.unwrap_or(Value::Null),
            destination: message.destination,
            ts:  message.ts.unwrap_or(SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64),
            id: message
                .id
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
        }
    }
}


pub trait MessageQueue {
    fn subscribe(&mut self, event_glob: String) -> Result<bool, PatternError>;
    fn unsubscribe(&mut self, event_glob: String) -> Result<bool, PatternError>;
    fn on(&mut self, event_name: String, callback: Callback);
    fn once(&mut self, event_name: String, callback: Callback);
    fn push(&mut self, message: MessageQueueMessage);
}