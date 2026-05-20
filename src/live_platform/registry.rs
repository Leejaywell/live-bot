use std::collections::BTreeMap;
use std::sync::Arc;

use crate::live_platform::adapter::LivePlatform;
use crate::live_platform::types::PlatformId;

#[derive(Clone, Default)]
pub struct PlatformRegistry {
    platforms: Arc<BTreeMap<PlatformId, Arc<dyn LivePlatform>>>,
}

impl PlatformRegistry {
    pub fn new(platforms: Vec<Arc<dyn LivePlatform>>) -> Self {
        let mut map = BTreeMap::new();
        for platform in platforms {
            map.insert(platform.id(), platform);
        }
        Self {
            platforms: Arc::new(map),
        }
    }

    pub fn get(&self, platform_id: &PlatformId) -> Option<Arc<dyn LivePlatform>> {
        self.platforms.get(platform_id).cloned()
    }

    pub fn list(&self) -> Vec<PlatformId> {
        self.platforms.keys().cloned().collect()
    }
}
