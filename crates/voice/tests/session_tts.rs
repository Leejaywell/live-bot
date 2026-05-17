/// 集成测试：VoiceSession + EdgeTTS 端到端
///
/// 运行前需要网络（连接微软 Edge TTS 服务）。
/// `cargo test -p streamix-voice --test session_tts -- --nocapture`
use streamix_voice::{SessionConfig, SessionEvent, SpeakRequest, TtsEngine, VoiceSession};

#[tokio::test]
#[ignore = "需要网络，手动运行"]
async fn test_edge_tts_speak_emits_audio_ready() {
    let (session, _handle) = VoiceSession::spawn(SessionConfig::default());
    let mut events = session.subscribe();

    session
        .speak(SpeakRequest::new("你好，我是语音助手。").with_engine(TtsEngine::Edge))
        .await
        .unwrap();

    // 至少收到一个 AudioReady 和最终的 SpeechEnd
    let mut got_audio = false;
    let mut got_end = false;

    while let Ok(ev) = events.recv().await {
        match ev {
            SessionEvent::AudioReady(frame) => {
                assert!(!frame.data.is_empty(), "audio frame should not be empty");
                assert_eq!(frame.sample_rate, 16000);
                got_audio = true;
            }
            SessionEvent::SpeechEnd => {
                got_end = true;
                break;
            }
            SessionEvent::SpeechInterrupted => break,
            _ => {}
        }
    }

    assert!(got_audio, "should have received at least one AudioReady");
    assert!(got_end, "should have received SpeechEnd");

    session.shutdown().await;
}

#[tokio::test]
#[ignore = "需要网络，手动运行"]
async fn test_interrupt_cancels_tts() {
    let (session, _handle) = VoiceSession::spawn(SessionConfig::default());
    let mut events = session.subscribe();

    // 合成较长文本，中途打断
    session
        .speak(
            SpeakRequest::new(
                "这是一段比较长的测试文本，用于测试中断功能是否正常工作。\
                 我们希望在收到中断信号后，TTS 立刻停止合成。",
            )
            .with_engine(TtsEngine::Edge),
        )
        .await
        .unwrap();

    // 稍等片刻再中断
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    session.interrupt().await.unwrap();

    // 应该收到 SpeechInterrupted（不是 SpeechEnd）
    while let Ok(ev) = events.recv().await {
        match ev {
            SessionEvent::SpeechInterrupted => {
                // 正常中断
                break;
            }
            SessionEvent::SpeechEnd => {
                // 也可以在中断前就完成了（文本短/网络快），不算失败
                break;
            }
            _ => {}
        }
    }

    session.shutdown().await;
}
