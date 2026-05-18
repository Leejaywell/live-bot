#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SongCommand {
    Search { query: String },
    Confirm { index: usize },
    MoreCandidates,
    MyRequest,
    CancelMine,
}

pub fn parse_song_command(text: &str) -> Option<SongCommand> {
    let value = text.trim();
    if value == "我的点歌" {
        return Some(SongCommand::MyRequest);
    }
    if value == "取消点歌" {
        return Some(SongCommand::CancelMine);
    }
    if value == "换一批" {
        return Some(SongCommand::MoreCandidates);
    }

    for prefix in ["点歌", "确认", "选"] {
        let Some(rest) = value.strip_prefix(prefix) else {
            continue;
        };
        let rest = rest.trim();
        if rest.is_empty() {
            return None;
        }
        let index_text = rest.strip_prefix('#').unwrap_or(rest).trim();
        if let Ok(index) = index_text.parse::<usize>() {
            if index > 0 {
                return Some(SongCommand::Confirm { index });
            }
        }
        if prefix == "点歌" {
            return Some(SongCommand::Search {
                query: rest.to_string(),
            });
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{SongCommand, parse_song_command};

    #[test]
    fn parses_plain_song_request() {
        assert_eq!(
            parse_song_command("点歌 晴天 周杰伦"),
            Some(SongCommand::Search {
                query: "晴天 周杰伦".to_string()
            })
        );
    }

    #[test]
    fn parses_number_confirmation() {
        assert_eq!(
            parse_song_command("点歌 #2"),
            Some(SongCommand::Confirm { index: 2 })
        );
        assert_eq!(
            parse_song_command("确认 3"),
            Some(SongCommand::Confirm { index: 3 })
        );
    }

    #[test]
    fn parses_queue_status_and_cancel() {
        assert_eq!(parse_song_command("我的点歌"), Some(SongCommand::MyRequest));
        assert_eq!(
            parse_song_command("取消点歌"),
            Some(SongCommand::CancelMine)
        );
    }

    #[test]
    fn ignores_unrelated_danmu() {
        assert_eq!(parse_song_command("主播晚上好"), None);
        assert_eq!(parse_song_command("点歌"), None);
    }
}
