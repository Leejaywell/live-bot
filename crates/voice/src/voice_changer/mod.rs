#[cfg(feature = "voice-changer")]
pub mod rvc;

#[cfg(feature = "voice-changer")]
pub struct VoiceChanger {
    engine: Option<rvc::RvcEngine>,
}

#[cfg(feature = "voice-changer")]
impl VoiceChanger {
    pub fn new() -> Self {
        Self { engine: None }
    }

    pub fn load_model(&mut self, model_path: &str, hubert_path: &str) -> anyhow::Result<()> {
        let engine = rvc::RvcEngine::new(model_path, hubert_path)?;
        self.engine = Some(engine);
        Ok(())
    }

    pub fn process(&self, input: &[f32]) -> anyhow::Result<Vec<f32>> {
        if let Some(engine) = &self.engine {
            engine.process(input)
        } else {
            anyhow::bail!("Voice changer engine not loaded")
        }
    }
}
