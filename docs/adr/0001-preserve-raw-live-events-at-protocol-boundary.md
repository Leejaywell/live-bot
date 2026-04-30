# Preserve raw live events at the protocol boundary

The app needs persisted interaction records that keep both stable query fields and the original Bilibili event payload. We will add a wrapper such as `ParsedLiveEvent { event, raw }` in the protocol crate instead of embedding raw JSON into the existing `LiveEvent` enum, so current rule handling can keep using normalized events while storage can retain the full payload for future statistics and reprocessing.
