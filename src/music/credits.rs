use serde::{Deserialize, Serialize};

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SongRequestTier {
    Ordinary,
    Priority,
    JumpQueue,
    Exclusive,
    PlaylistTakeover,
}

impl SongRequestTier {
    #[allow(dead_code)]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ordinary => "ordinary",
            Self::Priority => "priority",
            Self::JumpQueue => "jump_queue",
            Self::Exclusive => "exclusive",
            Self::PlaylistTakeover => "playlist_takeover",
        }
    }

    #[allow(dead_code)]
    pub fn base_score(self) -> i64 {
        match self {
            Self::Ordinary => 1000,
            Self::Priority => 3000,
            Self::JumpQueue => 6000,
            Self::Exclusive => 9000,
            Self::PlaylistTakeover => 12000,
        }
    }
}

#[allow(dead_code)]
pub fn tier_for_credit(value: i64) -> Option<SongRequestTier> {
    match value {
        1999.. => Some(SongRequestTier::PlaylistTakeover),
        520.. => Some(SongRequestTier::Exclusive),
        233.. => Some(SongRequestTier::JumpQueue),
        66.. => Some(SongRequestTier::Priority),
        10.. => Some(SongRequestTier::Ordinary),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{tier_for_credit, SongRequestTier};

    #[test]
    fn maps_credit_to_highest_reached_tier() {
        assert_eq!(tier_for_credit(9), None);
        assert_eq!(tier_for_credit(10), Some(SongRequestTier::Ordinary));
        assert_eq!(tier_for_credit(66), Some(SongRequestTier::Priority));
        assert_eq!(tier_for_credit(233), Some(SongRequestTier::JumpQueue));
        assert_eq!(tier_for_credit(520), Some(SongRequestTier::Exclusive));
        assert_eq!(
            tier_for_credit(1999),
            Some(SongRequestTier::PlaylistTakeover)
        );
    }
}
