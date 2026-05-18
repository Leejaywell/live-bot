use crate::music::credits::SongRequestTier;

#[allow(dead_code)]
pub fn priority_score(
    tier: SongRequestTier,
    credit_value: i64,
    fan_bonus: i64,
    repeat_count: i64,
) -> i64 {
    let capped_credit = credit_value.clamp(0, 2000);
    let penalty = repeat_count.max(0) * 300;
    tier.base_score() + capped_credit + fan_bonus.clamp(0, 500) - penalty
}

#[cfg(test)]
mod tests {
    use super::priority_score;
    use crate::music::credits::SongRequestTier;

    #[test]
    fn higher_tiers_sort_above_lower_tiers() {
        let ordinary = priority_score(SongRequestTier::Ordinary, 100, 0, 0);
        let jump = priority_score(SongRequestTier::JumpQueue, 233, 0, 0);
        assert!(jump > ordinary);
    }

    #[test]
    fn repeat_penalty_reduces_score() {
        let first = priority_score(SongRequestTier::Priority, 66, 0, 0);
        let repeated = priority_score(SongRequestTier::Priority, 66, 0, 2);
        assert!(first > repeated);
    }
}
