use glob::{Pattern, PatternError};
use napi::{JsFunction};
use napi::{
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode}
};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
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

pub struct LocalMQ {
    subscriptions: HashSet<Pattern>,
    once_callbacks: HashMap<String, Vec<Callback>>,
    push_callbacks: HashMap<String, Vec<Callback>>,
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


impl LocalMQ {
    pub fn new() -> Self {
        LocalMQ {
            subscriptions: HashSet::new(),
            once_callbacks: HashMap::new(),
            push_callbacks: HashMap::new(),
        }
    }

    pub fn subscribe(&mut self, event_glob: String) -> Result<bool, PatternError> {
        Pattern::new(&event_glob).and_then(|f| Ok(self.subscriptions.insert(f)))
    }

    pub fn unsubscribe(&mut self, event_glob: String) -> Result<bool, PatternError> {
        Pattern::new(&event_glob).and_then(|f| Ok(self.subscriptions.remove(&f)))
    }

    pub fn on(&mut self, event_name: String, callback: Callback) {
        match self.push_callbacks.get_mut(&event_name) {
            Some(existing) => {
                existing.push(callback);
            }
            None => {
                self.push_callbacks.insert(event_name, vec![callback]);
            }
        }
    }

    pub fn once(&mut self, event_name: String, callback: Callback) {
        match self.once_callbacks.get_mut(&event_name) {
            Some(existing) => {
                existing.push(callback);
            }
            None => {
                self.once_callbacks.insert(event_name, vec![callback]);
            }
        }
    }

    pub fn push(&mut self, message: MessageQueueMessage) {
        if self
            .subscriptions
            .iter()
            .find(|&glob| glob.matches(message.event_name.as_str()))
            .is_none()
        {
            println!("no pattern match");
            return;
        }

        let once_vec = self.once_callbacks.remove(&message.event_name);

        if once_vec.is_some() {
            for callback in once_vec.unwrap() {
                match callback {
                    Callback::RsCallback(cb) => cb(&message),
                    Callback::JsCallback(cb) => {
                        let cb_instance = cb.clone();
                        cb_instance.call(
                            Ok(message.clone()),
                            ThreadsafeFunctionCallMode::NonBlocking,
                        );
                    }
                }
            }
        }

        let push_vec = self.push_callbacks.get(&message.event_name);

        if push_vec.is_some() {
            for callback in push_vec.unwrap() {
                match callback {
                    Callback::RsCallback(cb) => cb(&message),
                    Callback::JsCallback(cb) => {
                        let cb_instance: ThreadsafeFunction<MessageQueueMessage> = cb.clone();
                        cb_instance.call(
                            Ok(message.clone()),
                            ThreadsafeFunctionCallMode::NonBlocking,
                        );
                    }
                }
            }
        }
    }
}

#[napi(js_name = "LocalMQ")]
pub struct JsLocalMQ {
    mq: LocalMQ,
}

#[napi]
impl JsLocalMQ {
    #[napi(constructor)]
    pub fn new() -> Self {
        JsLocalMQ { mq: LocalMQ::new() }
    }

    #[napi]
    pub fn subscribe(&mut self, event_glob: String) -> napi::Result<bool> {
        match self.mq.subscribe(event_glob) {
            Err(e) => Err(napi::Error::new(napi::Status::InvalidArg, e.to_string())),
            Ok(v) => Ok(v),
        }
    }

    #[napi]
    pub fn unsubscribe(&mut self, event_glob: String) -> napi::Result<bool> {
        match self.mq.unsubscribe(event_glob) {
            Err(e) => Err(napi::Error::new(napi::Status::InvalidArg, e.to_string())),
            Ok(v) => Ok(v),
        }
    }

    #[napi]
    pub fn on(&mut self, event_glob: String, callback: JsFunction) -> napi::Result<()> {
        let tsfn: ThreadsafeFunction<MessageQueueMessage> =
            callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
        self.mq.on(event_glob, Callback::JsCallback(tsfn));
        Ok(())
    }

    #[napi]
    pub fn once(&mut self, event_glob: String, callback: JsFunction) -> napi::Result<()> {
        let tsfn: ThreadsafeFunction<MessageQueueMessage> =
            callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
        self.mq.once(event_glob, Callback::JsCallback(tsfn));
        Ok(())
    }

    #[napi]
    pub fn push(&mut self, message: MessageQueueMessagePushJsPush) {
        self.mq.push(MessageQueueMessage::from_js_message(message));
    }
}

#[test]
fn test_callback() {
    let mut mq = LocalMQ::new();

    mq.on(
        "test-ev".to_owned(),
        Callback::RsCallback(|msg: &MessageQueueMessage| {
            println!("hello there! {}", msg.event_name);
        }),
    );

    mq.subscribe("test-ev".to_owned()).unwrap();

    mq.push(MessageQueueMessage::new("test-ev", "fibble", Value::Null));
}
