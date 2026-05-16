use anyhow::Result;

pub struct RvcEngine {
}

impl RvcEngine {
    pub fn new(_model_path: &str, _hubert_path: &str) -> Result<Self> {
        Ok(Self {})
    }

    pub fn process(&self, input: &[f32]) -> Result<Vec<f32>> {
        // Dummy implementation to unblock compilation
        Ok(input.to_vec())
    }
}
