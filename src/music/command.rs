#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SongCommand {
    Search { query: String },
    Confirm { index: usize },
    MoreCandidates,
    MyRequest,
    MyCredit,
    CancelMine,
}

#[allow(dead_code)]
pub fn parse_song_command(text: &str) -> Option<SongCommand> {
    let value = text.trim();
    if value == "我的点歌" {
        return Some(SongCommand::MyRequest);
    }
    if matches!(value, "我的积分" | "点歌积分" | "我的档位" | "点歌档位") {
        return Some(SongCommand::MyCredit);
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
        if let Some(index_text) = rest.strip_prefix('#') {
            if let Some(index) = parse_hash_confirmation_index(index_text) {
                return Some(SongCommand::Confirm { index });
            }
        } else if prefix != "点歌" {
            if let Ok(index) = rest.parse::<usize>() {
                if index > 0 {
                    return Some(SongCommand::Confirm { index });
                }
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

fn parse_hash_confirmation_index(text: &str) -> Option<usize> {
    let text = text.trim();
    let digit_end = text
        .char_indices()
        .take_while(|(_, ch)| ch.is_ascii_digit())
        .map(|(index, ch)| index + ch.len_utf8())
        .last()?;
    let (index_text, suffix) = text.split_at(digit_end);
    let suffix = suffix.trim();
    if !suffix.is_empty() && suffix != "确认" && suffix != "确定" {
        return None;
    }
    let index = index_text.parse::<usize>().ok()?;
    (index > 0).then_some(index)
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
            parse_song_command("点歌 #1 确认"),
            Some(SongCommand::Confirm { index: 1 })
        );
        assert_eq!(
            parse_song_command("点歌 #2确认"),
            Some(SongCommand::Confirm { index: 2 })
        );
        assert_eq!(
            parse_song_command("点歌 #2 确定"),
            Some(SongCommand::Confirm { index: 2 })
        );
        assert_eq!(
            parse_song_command("确认 3"),
            Some(SongCommand::Confirm { index: 3 })
        );
        assert_eq!(
            parse_song_command("选 2"),
            Some(SongCommand::Confirm { index: 2 })
        );
        assert_eq!(
            parse_song_command("选 #2"),
            Some(SongCommand::Confirm { index: 2 })
        );
        assert_eq!(
            parse_song_command("点歌 2002"),
            Some(SongCommand::Search {
                query: "2002".to_string()
            })
        );
    }

    #[test]
    fn parses_queue_status_and_cancel() {
        assert_eq!(parse_song_command("我的点歌"), Some(SongCommand::MyRequest));
        assert_eq!(parse_song_command("我的积分"), Some(SongCommand::MyCredit));
        assert_eq!(parse_song_command("点歌积分"), Some(SongCommand::MyCredit));
        assert_eq!(parse_song_command("我的档位"), Some(SongCommand::MyCredit));
        assert_eq!(parse_song_command("点歌档位"), Some(SongCommand::MyCredit));
        assert_eq!(
            parse_song_command("取消点歌"),
            Some(SongCommand::CancelMine)
        );
        assert_eq!(
            parse_song_command("换一批"),
            Some(SongCommand::MoreCandidates)
        );
    }

    #[test]
    fn ignores_unrelated_danmu() {
        assert_eq!(parse_song_command("主播晚上好"), None);
        assert_eq!(parse_song_command("点歌"), None);
        assert_eq!(parse_song_command("选"), None);
    }
}
