use std::collections::LinkedList;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use rand::prelude::*;

const BACKOFF_TIME_MAX_MS: f32 = 24f32 * 60f32 * 60f32 * 1000f32;
const BACKOFF_POW: f32 = 1.05f32;
const BACKOFF_TIME_MS: f32 = 5f32 * 1000f32;

#[napi]

pub struct QueueWithBackoff {
    queue: LinkedList<String>,
    backoff: HashMap<String, u128>,
    last_backoff: HashMap<String, u32>
}

#[napi]

impl QueueWithBackoff {
    #[napi(constructor)]
    pub fn new() -> Self {
        QueueWithBackoff {
            queue: LinkedList::new(),
            backoff: HashMap::new(),
            last_backoff: HashMap::new(),
        }
    }


    #[napi]
    pub fn next(&mut self) -> Option<String> {
        let start = SystemTime::now();
        let since_the_epoch = start
            .duration_since(UNIX_EPOCH).unwrap();

        let mut items_to_rm: Vec<String> = vec![];
        for item in self.backoff.iter() {
            if *item.1 < since_the_epoch.as_millis() {
                self.queue.push_back(item.0.clone());
                items_to_rm.push(item.0.clone());
            }
        }

        for item in items_to_rm {
            self.backoff.remove(&item);
        }

        return self.queue.pop_front()
    }


    #[napi]
    pub fn push(&mut self, item: String) {
        self.last_backoff.remove(&item);
        self.queue.push_back(item);
    }


    #[napi]
    pub fn backoff(&mut self, item: String) -> u32 {
        let last_backoff = (*self.last_backoff.get(&item).unwrap_or(&0)) as f32;

        let mut rng = rand::thread_rng();
        let y: f32 = rng.gen::<f32>() + 0.5f32; // generates a float between 0 and 1

        let backoff_duration = ((y * BACKOFF_TIME_MS) + f32::from(last_backoff).powf(BACKOFF_POW)).min(BACKOFF_TIME_MAX_MS) as u32;
        let backoff_item = item.clone();
        self.last_backoff.insert(item, backoff_duration);

        let start = SystemTime::now();
        let since_the_epoch = start
            .duration_since(UNIX_EPOCH).unwrap();

        let time = since_the_epoch.as_millis() + backoff_duration as u128;

        self.backoff.insert(backoff_item, time);
        return backoff_duration;
    }


    #[napi]
    pub fn length(&self) -> u32 {
        self.queue.len() as u32
    }

    #[napi]
    pub fn shuffle(&mut self) {
        let mut rng = rand::thread_rng();
        let old_queue = self.queue.clone();
        self.queue.clear();
        for item in old_queue {
            if rng.gen_bool(0.5) {
                self.queue.push_front(item);
            } else {
                self.queue.push_back(item);
            }
        }
    }
}