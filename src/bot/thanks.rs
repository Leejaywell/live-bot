use std::collections::BTreeMap;

use bilibili_live_protocol::LiveEvent;
use tokio::sync::mpsc;
use tokio::time::{Duration, interval};
use tokio_util::sync::CancellationToken;

use crate::config::AppConfig;
use crate::storage::Storage;

#[derive(Debug, Clone)]
pub struct GiftAggregator {
    danmu_len: i32,
    thanks_min_cost: i32,
    blind_box_profit_loss_stat: bool,
    gifts: BTreeMap<String, BTreeMap<String, GiftSummary>>,
    blind_boxes: BTreeMap<String, BTreeMap<String, BlindBoxSummary>>,
}

#[derive(Debug, Clone, Default)]
struct GiftSummary {
    count: i64,
    cost: i64,
}

#[derive(Debug, Clone, Default)]
struct BlindBoxSummary {
    user_id: i64,
    count: i64,
    profit_loss: i64,
}

impl GiftAggregator {
    pub fn new(config: &AppConfig) -> Self {
        Self {
            danmu_len: config.danmu_len,
            thanks_min_cost: config.thanks_min_cost,
            blind_box_profit_loss_stat: config.blind_box_profit_loss_stat,
            gifts: BTreeMap::new(),
            blind_boxes: BTreeMap::new(),
        }
    }

    pub fn record(&mut self, event: &LiveEvent, storage: Option<&Storage>) {
        let LiveEvent::Gift {
            user_id,
            user,
            gift,
            count,
            price,
            original_gift_name,
            original_gift_price,
        } = event
        else {
            return;
        };

        let gift_name = original_gift_name
            .as_ref()
            .map(|original| original.replace("盲盒", ""))
            .filter(|original| !original.is_empty())
            .map(|original| format!("{gift}({original})"))
            .unwrap_or_else(|| gift.clone());
        let summary = self
            .gifts
            .entry(user.clone())
            .or_default()
            .entry(gift_name)
            .or_default();
        summary.count += count;
        summary.cost += price * count;

        if self.blind_box_profit_loss_stat {
            if let Some(original_name) = original_gift_name.as_ref().filter(|name| !name.is_empty())
            {
                let profit_loss = (price - original_gift_price) * count;
                let summary = self
                    .blind_boxes
                    .entry(user.clone())
                    .or_default()
                    .entry(original_name.clone())
                    .or_default();
                summary.user_id = *user_id;
                summary.count += count;
                summary.profit_loss += profit_loss;
                if let Some(storage) = storage {
                    let _ = storage.record_blind_box_stat(
                        *user_id,
                        user,
                        original_name,
                        *count,
                        profit_loss,
                    );
                }
            }
        }
    }

    pub fn flush(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        out.extend(self.flush_gifts());
        out.extend(self.flush_blind_boxes());
        out
    }

    fn flush_gifts(&mut self) -> Vec<String> {
        let gifts = std::mem::take(&mut self.gifts);
        let mut out = Vec::new();
        for (user, by_gift) in gifts {
            let total_cost = by_gift.values().map(|summary| summary.cost).sum::<i64>();
            if total_cost < self.thanks_min_cost as i64 {
                continue;
            }
            let gift_text = by_gift
                .into_iter()
                .map(|(gift, summary)| format!("{}个{}", summary.count, gift))
                .collect::<Vec<_>>()
                .join("，");
            let msg = format!("感谢{user}的{gift_text}");
            if msg.chars().count() > self.danmu_len as usize {
                out.push(format!("感谢 {user} 的"));
                out.push(gift_text);
            } else {
                out.push(msg);
            }
        }
        out
    }

    fn flush_blind_boxes(&mut self) -> Vec<String> {
        let blind_boxes = std::mem::take(&mut self.blind_boxes);
        let mut out = Vec::new();
        for (user, by_box) in blind_boxes {
            let text = by_box
                .into_iter()
                .map(|(gift, summary)| {
                    let value = (summary.profit_loss.abs() as f64) / 1000.0;
                    if summary.profit_loss >= 0 {
                        format!("{}个{}赚了＋{value:.2}元", summary.count, gift)
                    } else {
                        format!("{}个{}亏了－{value:.2}元", summary.count, gift)
                    }
                })
                .collect::<Vec<_>>()
                .join("，");
            let msg = format!("{user}的{text}");
            if msg.chars().count() > self.danmu_len as usize {
                out.push(format!("{user}的"));
                out.push(text);
            } else {
                out.push(msg);
            }
        }
        out
    }
}

pub async fn run_gift_aggregator(
    mut rx: mpsc::Receiver<LiveEvent>,
    tx: mpsc::Sender<String>,
    cancel: CancellationToken,
    config: AppConfig,
    storage: std::sync::Arc<Storage>,
) {
    let timeout = Duration::from_secs(config.thanks_gift_timeout.max(1) as u64);
    let mut ticker = interval(timeout);
    let mut aggregator = GiftAggregator::new(&config);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => return,
            Some(event) = rx.recv() => aggregator.record(&event, Some(&storage)),
            _ = ticker.tick() => {
                for message in aggregator.flush() {
                    if tx.send(message).await.is_err() {
                        return;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use bilibili_live_protocol::LiveEvent;

    use super::GiftAggregator;
    use crate::bot::testsupport::test_config;
    use crate::storage::Storage;

    #[test]
    fn aggregates_multiple_gifts_for_same_user() {
        let mut config = test_config();
        config.thanks_min_cost = 0;
        let mut aggregator = GiftAggregator::new(&config);
        let event = LiveEvent::Gift {
            user_id: 1,
            user: "alice".to_string(),
            gift: "辣条".to_string(),
            count: 2,
            price: 100,
            original_gift_name: None,
            original_gift_price: 0,
        };

        aggregator.record(&event, None);
        aggregator.record(&event, None);

        assert_eq!(aggregator.flush(), vec!["感谢alice的4个辣条"]);
    }

    #[test]
    fn discards_gifts_below_min_cost() {
        let mut config = test_config();
        config.thanks_min_cost = 500;
        let mut aggregator = GiftAggregator::new(&config);

        aggregator.record(
            &LiveEvent::Gift {
                user_id: 1,
                user: "alice".to_string(),
                gift: "辣条".to_string(),
                count: 1,
                price: 100,
                original_gift_name: None,
                original_gift_price: 0,
            },
            None,
        );

        assert!(aggregator.flush().is_empty());
    }

    #[test]
    fn records_blind_box_profit_loss() {
        let config = test_config();
        let storage = Storage::open_in_memory().unwrap();
        let mut aggregator = GiftAggregator::new(&config);

        aggregator.record(
            &LiveEvent::Gift {
                user_id: 1,
                user: "alice".to_string(),
                gift: "礼物A".to_string(),
                count: 2,
                price: 300,
                original_gift_name: Some("盲盒".to_string()),
                original_gift_price: 100,
            },
            Some(&storage),
        );

        assert_eq!(storage.blind_box_profit_loss(1).unwrap(), 400);
        assert_eq!(
            aggregator.flush(),
            vec!["感谢alice的2个礼物A", "alice的2个盲盒赚了＋0.40元"]
        );
    }
}
