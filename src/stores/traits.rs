trait StorageProvider {
    async fn store_feed_guids(&mut self, url: &String, guids: &Vec<String>) -> Result<Ok, Err<String>>;
    async fn has_seen_feed(&self, url: &String, guids: &Vec<String>) -> Result<bool, Err<String>>;
    async fn has_seen_feed_guids(&self, url: &String, guids: &Vec<String>) -> Result<Vec<String>, Err<String>>;
}