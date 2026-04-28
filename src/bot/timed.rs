use crate::config::CronDanmu;

pub fn normalize_cron(expression: &str) -> Option<String> {
    let parts = expression.split_whitespace().collect::<Vec<_>>();
    match parts.len() {
        5 => Some(format!("0 {}", parts.join(" "))),
        6 => Some(parts.join(" ")),
        _ => None,
    }
}

pub fn select_timed_message(entry: &CronDanmu, index: &mut usize) -> Option<String> {
    match entry.danmu.len() {
        0 => None,
        1 => Some(entry.danmu[0].clone()),
        len if entry.random => Some(entry.danmu[rand::random_range(0..len)].clone()),
        len => {
            let item = entry.danmu[*index % len].clone();
            *index = (*index + 1) % len;
            Some(item)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_cron, select_timed_message};
    use crate::config::CronDanmu;

    #[test]
    fn normalizes_five_field_cron_with_zero_seconds() {
        assert_eq!(
            normalize_cron("*/1 * * * *").as_deref(),
            Some("0 */1 * * * *")
        );
    }

    #[test]
    fn leaves_six_field_cron_as_is() {
        assert_eq!(
            normalize_cron("30 * * * * *").as_deref(),
            Some("30 * * * * *")
        );
    }

    #[test]
    fn sequential_timed_message_advances_index() {
        let entry = CronDanmu {
            cron: "* * * * *".to_string(),
            random: false,
            danmu: vec!["a".to_string(), "b".to_string()],
        };
        let mut index = 0;

        assert_eq!(
            select_timed_message(&entry, &mut index).as_deref(),
            Some("a")
        );
        assert_eq!(
            select_timed_message(&entry, &mut index).as_deref(),
            Some("b")
        );
        assert_eq!(
            select_timed_message(&entry, &mut index).as_deref(),
            Some("a")
        );
    }
}
