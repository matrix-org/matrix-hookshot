use std::collections::{HashMap, HashSet};
use std::future;
use crate::util::QueueWithBackoff;
use std::time::{Duration, Instant};
use napi::bindgen_prelude::Error as JsError;
use napi::tokio::sync::RwLock;
use std::sync::Arc;
use uuid::Uuid;
use futures::future::{Future, select_all};
use crate::feeds::parser::{js_read_feed, ReadFeedOptions};
use crate::stores::memory::MemoryStorageProvider;
use crate::stores::traits::StorageProvider;

const BACKOFF_TIME_MAX_MS: f64 = 24f64 * 60f64 * 60f64 * 1000f64;
const BACKOFF_POW: f64 = 1.05f64;
const BACKOFF_TIME_MS: f64 = 5f64 * 1000f64;

#[derive(Serialize, Debug, Deserialize)]
#[napi(object)]
struct HookshotFeedInfo {
    pub title: String,
    pub url: String,
    pub entries: Vec<HookshotFeedEntry>,
    pub fetch_key: String,
}

#[derive(Serialize, Debug, Deserialize)]
#[napi(object)]
struct HookshotFeedEntry {
    pub title: Option<String>,
    pub pubdate: Option<String>,
    pub summary: Option<String>,
    pub author: Option<String>,
    pub link: Option<String>,
}

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
    cache_times: Arc<RwLock<HashMap<String, CacheTime>>>,
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
        let mut cache_times: HashMap<String, CacheTime> = HashMap::new();
        let mut lock = Arc::new(RwLock::new(cache_times));
        FeedReader {
            queue: QueueWithBackoff::new(
                BACKOFF_TIME_MS,
                BACKOFF_POW,
                BACKOFF_TIME_MAX_MS,
            ),
            feeds_to_retain: HashSet::new(),
            poll_interval_seconds,
            poll_concurrency,
            poll_timeout_seconds,
            cache_times: lock,
        }
    }

    #[napi]
    pub fn get_metrics(&self) -> FeedReaderMetrics {
        FeedReaderMetrics {
            feeds_failing_http: 0,
            feeds_failing_parsing: 0,
        }
    }


    #[napi]
    pub fn on_new_url(&mut self, url: String) {
        self.queue.push(url);
    }

    #[napi]
    pub fn on_removed_url(&mut self) {

    }

    async fn poll_feed(&self, url: &String, cache_times: Arc<RwLock<HashMap<String, CacheTime>>>, mut storage: &impl StorageProvider) -> Result<Option<HookshotFeedInfo>, JsError> {
        let seen_entries_changed = false;
        let fetch_key = Uuid::new_v4().to_string();

        let c_t = cache_times.read().await;
        let cache_time = c_t.get(url);
        let etag = cache_time.and_then(|c| c.etag.clone()).or(None);
        let last_modified = cache_time.and_then(|c| c.last_modified.clone()).or(None);
        drop(c_t);

        if let Ok(result) = js_read_feed(url.clone(), ReadFeedOptions {
            poll_timeout_seconds: self.poll_timeout_seconds,
            etag,
            last_modified,
            user_agent: "faked user agent".to_string(),
        }).await {
            let mut c_t_w = cache_times.write().await;
            c_t_w.insert(url.clone(), CacheTime {
                etag: result.etag,
                last_modified: result.last_modified,
            });
            drop(c_t_w);

            let initial_sync = storage.has_seen_feed(url).await;
            let mut new_guids: Vec<String> = Vec::new();
            let new_entries: Vec<HookshotFeedEntry> = Vec::new();


            if let Some(feed) = result.feed {
                let items = feed.items.iter().map(|x| x.hash_id.clone()).collect::<Vec<_>>();
                let seen_items = storage.has_seen_feed_guids(
                    url,
                    &items,
                ).await;
                println!("Got feed result!");
                let mut feed_info = HookshotFeedInfo {
                    title: feed.title,
                    url: url.clone(),
                    entries: vec![],
                    fetch_key,
                };
                for item in feed.items {
                    println!("Got feed result! {:?}", item);
                    if seen_items.contains(&item.hash_id) {
                        continue;
                    }

                    new_guids.push(item.hash_id.clone());

                    if initial_sync {
                        // Skip.
                        continue;
                    }
                    feed_info.entries.push(HookshotFeedEntry {
                        title: item.title,
                        pubdate: item.pubdate,
                        summary: item.summary,
                        author: item.author,
                        link: item.link,
                    });
                }
                storage.store_feed_guids(&url, &new_guids).await;
                return Ok(Some(feed_info));
            } else {
                // TODO: Implement
            }


        } // TODO: Handle error.
        Ok(None)
    }

    fn sleeping_interval(&self) -> f64 {
        return (self.poll_interval_seconds * 1000.0) / self.queue.length() as f64;
    }

    async unsafe fn poll_feed_int(&mut self, url: &String, mut storage_provider: &impl StorageProvider) {
        let mut sleep_for = self.sleeping_interval();
        self.feeds_to_retain.insert(url.clone());
        let now = Instant::now();
        let result = self.poll_feed(url, self.cache_times.clone(), &storage_provider).await;
        self.feeds_to_retain.remove(url);
        let elapsed = now.elapsed();
        sleep_for = (sleep_for - (elapsed.as_millis() as f64)).max(0.0);
        async_std::task::sleep(Duration::from_millis(sleep_for as u64)).await;
    }

    #[napi]
    pub async unsafe fn poll_feeds(&mut self) -> Result<(), JsError> {
        let concurrency = self.poll_concurrency as usize;
        let mut storage_provider = MemoryStorageProvider::new();
        let mut future_set: Vec<_> = Vec::new();
        loop {
            if let Some(url) = self.queue.pop() {
                let result = Box::pin(self.poll_feed_int(&url, &storage_provider));
                future_set.push(result);
            } else {
                async_std::task::sleep(Duration::from_millis(self.sleeping_interval() as u64)).await;
            }
            if future_set.len() >= concurrency {
                let (item_resolved, ready_future_index, _remaining_futures) =
                select_all(future_set).await;
            } 
        }
    }
}