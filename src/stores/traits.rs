pub trait StorageProvider {
    async fn store_feed_guids(&mut self, url: &String, guids: &Vec<String>);
    async fn has_seen_feed(&self, url: &String) -> bool;
    async fn has_seen_feed_guids(&self, url: &String, guids: &Vec<String>) -> Vec<String>;
}