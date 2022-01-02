use clokwerk::Scheduler;
use octorust::{auth::Credentials, Client};
use super::types::NotificationWatcherTask;

#[napi]
pub struct GitHubWatcher {
  last_read_ts: u64,
  since: i64,
  user_id: String,
  room_id: String,
  participating: bool,
  github: Client,
}

#[napi]
impl GitHubWatcher {
  #[napi(constructor)]
  pub fn new(token: String, user_id: String, room_id: String, since: Option<i64>, participating: Option<bool>) -> Self {
    GitHubWatcher {
      last_read_ts: 0,
      user_id: user_id,
      room_id: room_id,
      since: since.unwrap_or(0),
      participating: participating.unwrap_or(false),
      github: Client::new(
        String::from("matrix-hookshot/1.0.0"),
        Credentials::Token(token),
      )
    }
  }
}

#[napi]
impl NotificationWatcherTask for GitHubWatcher {


  fn start(interval_ms: usize, scheduler: &Scheduler) {
    
  }

  fn stop() {
    todo!()
  }
}
