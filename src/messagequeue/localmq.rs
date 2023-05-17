use glob::{Pattern, PatternError};
use napi::{JsFunction};
use napi::{
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode}
};
use std::collections::{HashMap, HashSet};
use super::types::*;
use serde_json::Value;

pub struct LocalMQ {
    subscriptions: HashSet<Pattern>,
    once_callbacks: HashMap<String, Vec<Callback>>,
    push_callbacks: HashMap<String, Vec<Callback>>,
}

impl LocalMQ {
    fn new() -> Self {
        LocalMQ {
            subscriptions: HashSet::new(),
            once_callbacks: HashMap::new(),
            push_callbacks: HashMap::new(),
        }
    }
}

impl MessageQueue for LocalMQ {


    fn subscribe(&mut self, event_glob: String) -> Result<bool, PatternError> {
        Pattern::new(&event_glob).and_then(|f| Ok(self.subscriptions.insert(f)))
    }

    fn unsubscribe(&mut self, event_glob: String) -> Result<bool, PatternError> {
        Pattern::new(&event_glob).and_then(|f| Ok(self.subscriptions.remove(&f)))
    }

    fn on(&mut self, event_name: String, callback: Callback) {
        match self.push_callbacks.get_mut(&event_name) {
            Some(existing) => {
                existing.push(callback);
            }
            None => {
                self.push_callbacks.insert(event_name, vec![callback]);
            }
        }
    }

    fn once(&mut self, event_name: String, callback: Callback) {
        match self.once_callbacks.get_mut(&event_name) {
            Some(existing) => {
                existing.push(callback);
            }
            None => {
                self.once_callbacks.insert(event_name, vec![callback]);
            }
        }
    }

    fn push(&mut self, message: MessageQueueMessage) {
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
