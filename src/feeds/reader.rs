use std::collections::{HashMap, HashSet};
use crate::util::QueueWithBackoff;
use std::time::Instant;
use napi::bindgen_prelude::{Error as JsError, Status};
use uuid::Uuid;
use crate::feeds::parser::{js_read_feed, ReadFeedOptions};

const BACKOFF_TIME_MAX_MS: f64 = 24f64 * 60f64 * 60f64 * 1000f64;
const BACKOFF_POW: f64 = 1.05f64;
const BACKOFF_TIME_MS: f64 = 5f64 * 1000f64;

struct CacheTime {
    etag: Option<String>,
    last_modified: Option<String>,
}

impl CacheTime {
    fn new() -> Self {
        CacheTime {
            etag: None,
            last_modified: None,
        }
    }
}

#[napi]

pub struct FeedReader {
    queue: QueueWithBackoff,
    feeds_to_retain: HashSet<String>,
    cache_times: HashMap<String, CacheTime>,
    poll_interval_seconds: f64,
    poll_concurrency: u8,
    poll_timeout_seconds: i64,
}


#[napi]
pub struct FeedReaderMetrics {
    feeds_failing_http: usize,
    feeds_failing_parsing: usize,
}

#[napi]

impl FeedReader {
    #[napi(constructor)]
    pub fn new(poll_interval_seconds: f64, poll_concurrency: u8, poll_timeout_seconds: i64) -> Self {
        FeedReader {
            queue: QueueWithBackoff::new(
                BACKOFF_TIME_MS,
                BACKOFF_POW,
                BACKOFF_TIME_MAX_MS,
            ),
            feeds_to_retain: HashSet::new(),
            cache_times: HashMap::new(),
            poll_interval_seconds,
            poll_concurrency,
            poll_timeout_seconds,
        }
    }

    #[napi]
    pub fn get_metrics(&self) -> FeedReaderMetrics {
        FeedReaderMetrics {
            feeds_failing_http: 0,
            feeds_failing_parsing: 0,
        }
    }

    
    pub fn on_new_url(&mut self, url: String) {
        self.queue.push(url);
    }

    pub fn on_removed_url(&mut self) {

    }

    async fn poll_feed(&mut self, url: &String) -> Result<bool, JsError> {
        self.feeds_to_retain.insert(url.clone());
        let seen_entries_changed = false;
        let fetch_key = Uuid::new_v4().to_string();
        let cache_time = self.cache_times.get(url);

        if let Ok(result) = js_read_feed(url.clone(), ReadFeedOptions {
            poll_timeout_seconds: self.poll_timeout_seconds,
            etag: cache_time.and_then(|c| c.etag.clone()).or(None),
            last_modified: cache_time.and_then(|c| c.last_modified.clone()).or(None),
            user_agent: "faked user agent".to_string(),
        }).await {
            self.cache_times.insert(url.clone(), CacheTime {
                etag: result.etag,
                last_modified: result.last_modified,
            });

            let initial_sync = false; // TODO: Implement
            let seen_items: HashSet<String> = HashSet::new();  // TODO: Implement
            let mut new_guids: Vec<String> = Vec::new();

            if let Some(feed) = result.feed {
                for item in feed.items {
                    if let Some(hash_id) = item.hash_id {
                        if seen_items.contains(&hash_id) {
                            continue;
                        }
                        // TODO: Drop unwrap
                        new_guids.push(hash_id);

                        if initial_sync {
                            // Skip.
                            continue;
                        }
                        
                    }
                }
            } else {
                // TODO: Implement
            }


        } // TODO: Handle error.
        Ok(true)
    }

    fn sleeping_interval(&self) -> f64 {
        return (self.poll_interval_seconds * 1000.0) / self.queue.length() as f64;
    }

    #[napi]
    pub async unsafe fn poll_feeds(&mut self) -> Result<f64, JsError> {
        let now = Instant::now();

        if let Some(url) = self.queue.pop() {
            self.poll_feed(&url).await?;
            let elapsed = now.elapsed();
            let sleepFor = (self.sleeping_interval() - (elapsed.as_millis() as f64)).max(0.0);
            return Ok(sleepFor);
        } else {

        }
        return Ok(self.sleeping_interval());
    }
}