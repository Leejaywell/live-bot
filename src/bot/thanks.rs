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
    gift_aliases: BTreeMap<String, String>,
    gift_thanks_templates: BTreeMap<String, String>,
    gift_summary_thanks: bool,
    gift_summary_template: String,
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
            gift_aliases: config.gift_aliases.clone(),
            gift_thanks_templates: config.gift_thanks_templates.clone(),
            gift_summary_thanks: config.gift_summary_thanks,
            gift_summary_template: config.gift_summary_template.clone(),
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
        let gift_name = self
            .gift_aliases
            .get(&gift_name)
            .cloned()
            .unwrap_or(gift_name);
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
        let mut summary_count = 0;
        let mut summary_value = 0;
        for (user, by_gift) in gifts {
            let total_cost = by_gift.values().map(|summary| summary.cost).sum::<i64>();
            if total_cost < self.thanks_min_cost as i64 {
                continue;
            }
            summary_count += by_gift.values().map(|summary| summary.count).sum::<i64>();
            summary_value += total_cost;
            let gift_text = by_gift
                .into_iter()
                .map(|(gift, summary)| self.render_gift_thanks(&user, &gift, &summary))
                .collect::<Vec<_>>()
                .join("，");
            let msg = if gift_text.starts_with("感谢") || gift_text.starts_with("谢谢") {
                gift_text.clone()
            } else {
                format!("感谢{user}的{gift_text}")
            };
            if msg.chars().count() > self.danmu_len as usize {
                out.push(format!("感谢 {user} 的"));
                out.push(gift_text);
            } else {
                out.push(msg);
            }
        }
        if self.gift_summary_thanks && summary_count > 0 {
            out.push(
                self.gift_summary_template
                    .replace("{count}", &summary_count.to_string())
                    .replace("{value}", &summary_value.to_string()),
            );
        }
        out
    }

    fn render_gift_thanks(&self, user: &str, gift: &str, summary: &GiftSummary) -> String {
        self.gift_thanks_templates
            .get(gift)
            .map(|template| {
                template
                    .replace("{user}", user)
                    .replace("{gift}", gift)
                    .replace("{count}", &summary.count.to_string())
            })
            .unwrap_or_else(|| format!("{}个{}", summary.count, gift))
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
        config.gift_summary_thanks = false;
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
        let mut config = test_config();
        config.gift_summary_thanks = false;
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

    #[test]
    fn uses_gift_alias_and_specific_thanks_template() {
        let mut config = test_config();
        config.gift_summary_thanks = false;
        config
            .gift_aliases
            .insert("辣条".to_string(), "小零食".to_string());
        config.gift_thanks_templates.insert(
            "小零食".to_string(),
            "谢谢{user}投喂{count}份{gift}".to_string(),
        );
        let mut aggregator = GiftAggregator::new(&config);

        aggregator.record(
            &LiveEvent::Gift {
                user_id: 1,
                user: "alice".to_string(),
                gift: "辣条".to_string(),
                count: 2,
                price: 100,
                original_gift_name: None,
                original_gift_price: 0,
            },
            None,
        );

        assert_eq!(aggregator.flush(), vec!["谢谢alice投喂2份小零食"]);
    }

    #[test]
    fn appends_gift_summary_thanks() {
        let mut config = test_config();
        config.gift_summary_thanks = true;
        config.gift_summary_template = "本轮共收到{count}件礼物，价值{value}电池".to_string();
        let mut aggregator = GiftAggregator::new(&config);

        aggregator.record(
            &LiveEvent::Gift {
                user_id: 1,
                user: "alice".to_string(),
                gift: "辣条".to_string(),
                count: 2,
                price: 100,
                original_gift_name: None,
                original_gift_price: 0,
            },
            None,
        );
        aggregator.record(
            &LiveEvent::Gift {
                user_id: 2,
                user: "bob".to_string(),
                gift: "小心心".to_string(),
                count: 1,
                price: 50,
                original_gift_name: None,
                original_gift_price: 0,
            },
            None,
        );

        assert_eq!(
            aggregator.flush(),
            vec![
                "感谢alice的2个辣条",
                "感谢bob的1个小心心",
                "本轮共收到3件礼物，价值250电池"
            ]
        );
    }
}
