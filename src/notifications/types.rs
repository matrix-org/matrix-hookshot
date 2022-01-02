use clokwerk::{Scheduler};
pub trait NotificationWatcherTask {
    fn start(interval_ms: usize, scheduler: &Scheduler);
    fn stop();
}
