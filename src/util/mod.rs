use rand::prelude::*;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_BACKOFF_TIME_MAX_MS: f64 = 24f64 * 60f64 * 60f64 * 1000f64;
const DEFAULT_BACKOFF_POW: f64 = 1.05f64;
const DEFAULT_BACKOFF_TIME_MS: f64 = 5f64 * 1000f64;

#[napi]

pub struct QueueWithBackoff {
    queue: VecDeque<String>,
    /**
     * A map of absolute backoff timestamps mapped to the value.
     */
    backoff: BTreeMap<u64, String>,
    /**
     * The last duration applied when a value was backed off.
     */
    last_backoff_duration: HashMap<String, u32>,
    backoff_time: f64,
    backoff_exponent: f64,
    backoff_max: f64,
}

impl Default for QueueWithBackoff {
    fn default() -> Self {
        Self::new(
            DEFAULT_BACKOFF_TIME_MS,
            DEFAULT_BACKOFF_POW,
            DEFAULT_BACKOFF_TIME_MAX_MS,
        )
    }
}
#[napi]

impl QueueWithBackoff {
    #[napi(constructor)]
    pub fn new(backoff_time: f64, backoff_exponent: f64, backoff_max: f64) -> Self {
        QueueWithBackoff {
            queue: VecDeque::new(),
            backoff: BTreeMap::new(),
            last_backoff_duration: HashMap::new(),
            backoff_time,
            backoff_exponent,
            backoff_max,
        }
    }

    #[napi]
    pub fn pop(&mut self) -> Option<String> {
        let start = SystemTime::now();
        let since_the_epoch = start.duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;

        // We only need to check this once, as we won't be adding to the backoff queue
        // as often as we pull from it.
        if let Some(item) = self.backoff.first_entry() {
            if *item.key() < since_the_epoch {
                let v = item.remove();
                self.queue.push_back(v);
            }
        }

        self.queue.pop_front()
    }

    #[napi]
    pub fn remove(&mut self, item: String) -> bool {
        // Remove from the queue
        if let Ok(index) = self.queue.binary_search(&item) {
            self.queue.remove(index);
            return true;
        } else {
            // We didn't find the key queued, so let's ensure we delete it
            // from any backoff.
            // This is *expensive* but hopefully called rarely.
            let mut found_key: u64 = 0;
            for (key, value) in self.backoff.iter() {
                if *value == item {
                    found_key = *key;
                }
            }
            if found_key != 0 {
                self.backoff.remove(&found_key);
                return true;
            }
        }
        // Always remove the duration on removal.
        self.last_backoff_duration.remove(&item);
        false
    }

    #[napi]
    pub fn push(&mut self, item: String) {
        self.last_backoff_duration.remove(&item);
        self.queue.push_back(item);
    }

    #[napi]
    pub fn backoff(&mut self, item: String) -> u32 {
        let last_backoff = (*self.last_backoff_duration.get(&item).unwrap_or(&0)) as f64;

        let mut rng = rand::thread_rng();
        let y: f64 = rng.gen::<f64>() + 0.5f64; // generates a float between 0.5 and 1.1

        let backoff_duration = ((y * self.backoff_time) + last_backoff.powf(self.backoff_exponent))
            .min(self.backoff_max) as u32;
        let backoff_item = item.clone();
        self.last_backoff_duration.insert(item, backoff_duration);

        let start = SystemTime::now();
        let since_the_epoch = start.duration_since(UNIX_EPOCH).unwrap();

        let mut time = since_the_epoch.as_millis() as u64 + backoff_duration as u64;

        // If the backoff queue contains this time (likely)
        // then we want to increase the backoff time slightly
        // to allow for it.
        let incr: f64 = (rng.gen::<f64>() * 2f64) + 2f64;
        while self.backoff.contains_key(&time) {
            time += (incr * self.backoff_time) as u64;
        }

        self.backoff.insert(time, backoff_item);
        backoff_duration
    }

    #[napi]
    pub fn length(&self) -> u32 {
        self.queue.len() as u32
    }

    fn shuffle(&mut self) {
        let mut rng = rand::thread_rng();
        self.queue.make_contiguous().shuffle(&mut rng);
    }

    #[napi]
    pub fn populate(&mut self, values: Vec<String>) {
        // This assumes an empty queue.
        for v in values {
            self.queue.push_back(v);
        }
        self.shuffle();
    }
}
