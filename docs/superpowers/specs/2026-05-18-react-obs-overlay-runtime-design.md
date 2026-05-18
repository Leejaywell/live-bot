# React OBS Overlay Runtime Design

## Goal

Build a unified React-based OBS overlay runtime for all existing live plugin pages, while making the music interaction overlay the first full multi-theme showcase with decorative effects for livestream scenes.

## Current Context

The app currently serves OBS overlays from Axum as standalone static HTML files:

- `/` renders the danmaku overlay.
- `/wish-goal` renders the wish goal overlay.
- `/lottery` renders the lottery overlay.
- `/gift-effect` renders gift effects.
- `/recent-gifts` renders recent gifts.
- `/gift-rank` renders gift ranking.
- `/song-request/playlist`, `/song-request/now-playing`, and `/song-request/rank` render the music interaction overlay.

The music interaction backend loop is already functional: gifts and SuperChats create credits, users confirm candidates, confirmed songs enter a persistent queue, OBS can read queue JSON, and the anchor can open a queued request safely by request id. The current music overlay is still a small static HTML page with only basic `compact` and `minimal` skins.

## Scope

This project migrates all current OBS pages to a shared React overlay runtime.

Included in this project:

- Preserve every existing OBS URL.
- Serve one React overlay shell for all existing overlay pages.
- Route inside React based on `location.pathname`.
- Reuse existing Rust JSON APIs and WebSocket events.
- Keep all existing plugin behavior functionally equivalent after migration.
- Add runtime-level query options shared by all overlays: `skin`, `transparent`, `scale`, `motion`, and `primaryColor`.
- Implement full multi-theme visual treatment for music interaction.
- Keep other plugins on an equivalent default/compact presentation in this phase.

Not included in this project:

- A drag-and-drop custom UI editor.
- A persistent custom layout schema for users.
- Full multi-theme theme packs for every plugin.
- Replacing backend business rules with frontend logic.
- Audio waveform or real beat analysis for music effects.

## Architecture

Rust remains responsible for business data, safety, and OBS-accessible HTTP routes. React becomes responsible for rendering, theme selection, animation, layout, and empty/error states.

Axum will continue to own the public OBS URLs. Instead of returning a different hand-written HTML file per overlay, these routes will return the React overlay shell. The shell loads the overlay JavaScript bundle and renders the correct plugin component based on the path.

The overlay runtime will be separate from the plugin-center UI. It can share TypeScript types and utility code where practical, but it should not import plugin-center pages or controls. OBS overlays must never expose management buttons or settings forms.

## Overlay Routes

The following existing routes must keep working:

```text
/
/wish-goal
/lottery
/gift-effect
/recent-gifts
/gift-rank
/song-request/playlist
/song-request/now-playing
/song-request/rank
```

The runtime may also support future canonical routes, but the old routes remain the compatibility contract:

```text
/overlay/danmaku
/overlay/wish-goal
/overlay/lottery
/overlay/gift-effect
/overlay/recent-gifts
/overlay/gift-rank
/overlay/song-request/playlist
/overlay/song-request/now-playing
/overlay/song-request/rank
```

If canonical `/overlay/...` routes are added, they must render the same React components as the legacy routes. Existing OBS Browser Sources should not need to change.

## Runtime Query Options

All React overlays should parse these query options:

```text
skin=default|compact|neon|idol-stage|vinyl
transparent=1|0
scale=number
motion=full|reduced|off
primaryColor=#RRGGBB
```

Behavior:

- `skin` selects the visual theme. Unsupported skins fall back to the plugin default.
- `transparent=1` makes the page OBS-friendly with transparent page background.
- `scale` adjusts typography and spacing without changing the data model.
- `motion=full` enables all theme animations.
- `motion=reduced` keeps short state transitions but removes looping or high-flash animations.
- `motion=off` disables non-essential animation.
- `primaryColor` overrides the theme accent color when valid.

The runtime must also respect `prefers-reduced-motion` and downgrade `motion=full` to a safer reduced behavior for users who request reduced motion.

## Data Flow

React overlays read data through existing backend surfaces.

Music interaction uses:

```text
GET /song-request/api/queue
GET /song-request/api/now-playing
GET /song-request/api/rank
```

Other overlays continue to use their current JSON and WebSocket sources, including:

```text
GET /cfg
GET /plugin-settings
GET /local-resource
GET /proxy
GET /ws
```

The first implementation should keep the current refresh model for each plugin:

- Music interaction polls its JSON endpoints about every 3 seconds.
- Existing live-event-driven overlays keep WebSocket update behavior.
- Failures render safe empty states instead of throwing visible errors or leaving OBS white.

## React Runtime Structure

The implementation should introduce a small overlay app, separate from the main settings UI:

```text
src-tauri/src/overlay/
  main.tsx
  OverlayRouter.tsx
  runtime/
    query.ts
    motion.ts
    theme.ts
    types.ts
  components/
    OverlayFrame.tsx
    EmptyState.tsx
    MarqueeText.tsx
  plugins/
    danmaku/
    wish-goal/
    lottery/
    gift-effect/
    recent-gifts/
    gift-rank/
    song-request/
```

Responsibilities:

- `main.tsx` mounts React and applies global overlay CSS.
- `OverlayRouter.tsx` maps pathname to plugin overlay component.
- `runtime/query.ts` parses query parameters into a typed overlay config.
- `runtime/theme.ts` resolves plugin theme defaults and CSS variables.
- `runtime/motion.ts` resolves animation mode from query and browser preferences.
- `OverlayFrame.tsx` applies transparent background, scaling, dimensions, and CSS variables.
- Each plugin folder owns its display-only components and data hooks.

## Music Interaction Themes

Music interaction is the first full theme showcase.

### `neon`

Use for PK, gaming, and high-energy chat streams.

Layout:

- Strong current-song block.
- Queue preview with the next 3-4 songs.
- Session value or queue value badge.
- Visible tier labels for `jump_queue`, `exclusive`, and `playlist_takeover`.

Effects:

- New queued request slides in with a short glow.
- `jump_queue` adds a neon border pulse and "插队" badge.
- `exclusive` enlarges requester name and triggers a 2-3 second flow-light sweep.
- `playlist_takeover` shows a full-width sponsor strip: `本段歌单由 {uname} 包场`.

### `idol-stage`

Use for virtual anchors, talent streams, and fan-support scenes.

Layout:

- Stage banner composition.
- Requester name is prominent.
- Current song and tier appear like a stage lower-third.
- Queue preview is compact and secondary.

Effects:

- `exclusive` triggers fan-name highlight and stage beam animation.
- `playlist_takeover` shows a stage banner takeover.
- New queued request uses small star or light-stick style sparkles.

### `vinyl`

Use for music radio, chat, and listening streams.

Layout:

- Vinyl/card style player.
- Left side album cover when available, otherwise a themed record visual.
- Right side song, artist, requester, and next song.
- Queue preview is quiet and low contrast.

Effects:

- `playing` slowly rotates the record visual.
- New queued request softly slides into the next-song region.
- High tiers use gold badges and soft halos instead of aggressive flashes.

## Music Effect Triggers

Music effects do not depend on real audio analysis. They are triggered by backend state changes:

- New queue item: a request id appears that was not present in the previous poll.
- Now playing changed: the `requestId` from `/song-request/api/now-playing` changes.
- High tier present: `tier` is `jump_queue`, `exclusive`, or `playlist_takeover`.

The overlay keeps the previous response in memory and computes animation flags from the diff. These flags are visual-only. They must not change queue order, credit values, or playback state.

## Other Plugin Migration

All existing OBS plugin pages migrate to React in this project, but they do not need full theme packs yet.

Required behavior for non-music plugins:

- Preserve current data and update behavior.
- Support `transparent`, `scale`, `motion`, and `primaryColor` where visually relevant.
- Provide at least `default` and `compact` skins.
- Keep empty states and error states OBS-safe.
- Do not expose plugin-center controls or management actions.

Migration targets:

- Danmaku overlay: preserve live danmaku display and configuration behavior.
- Wish goal: preserve target, progress, title, and visual state.
- Lottery: preserve current lottery overlay behavior.
- Gift effect: preserve gift effect display and local resource access.
- Recent gifts: preserve recent gift list.
- Gift rank: preserve ranking display.

## Backward Compatibility

Existing OBS URLs must continue to work. The initial migration should keep legacy HTML files available as fallback until the React runtime is verified.

Accepted fallback strategy:

- Axum serves React shell for the legacy routes by default.
- Legacy files remain in the repository during the first migration.
- A build or runtime failure should be easy to revert by switching route handlers back to the legacy `include_str!` pages.

Static assets must be served with paths that work both in development and packaged builds. OBS Browser Source should not need access to Tauri internals or `file://` paths.

## Error Handling

Each overlay must render a safe state for these cases:

- API request fails.
- WebSocket disconnects.
- Plugin settings are missing or malformed.
- Queue or rank is empty.
- Song title, user name, or artist name is very long.
- Theme name is unknown.
- Motion mode is unknown.

Safe behavior means:

- No visible stack traces.
- No unhandled JS errors that leave a white page.
- No layout explosion from long text.
- No controls visible to viewers.

## OBS Visual Constraints

All overlays must satisfy these constraints:

- Transparent background support.
- Fixed-size friendly layout.
- Long text truncates or scrolls in a controlled way.
- No page scrollbars by default.
- No visible buttons, forms, or cursor-dependent UI.
- Animation should be CSS-first and lightweight.
- No heavy particle systems in the default mode.
- Reduced motion is supported.

## Testing Strategy

Implementation should verify:

- Route compatibility: every legacy route returns the React shell.
- Router mapping: each path renders the correct plugin overlay.
- Query parsing: invalid parameters fall back safely.
- Music theme rendering: `neon`, `idol-stage`, and `vinyl` render queue and now-playing data.
- Music animation diffing: new request id and changed playing id produce visual state flags.
- Error states: failed API calls render safe empty states.
- Production build: frontend overlay bundle is built and Axum can serve it.

Manual OBS smoke checks should include:

```text
http://127.0.0.1:<port>/song-request/playlist?skin=neon&transparent=1
http://127.0.0.1:<port>/song-request/now-playing?skin=vinyl&transparent=1
http://127.0.0.1:<port>/song-request/rank?skin=neon&transparent=1
http://127.0.0.1:<port>/gift-rank?transparent=1&skin=compact
http://127.0.0.1:<port>/wish-goal?transparent=1&skin=compact
```

## Phasing

Recommended implementation phases:

1. Add React overlay app and Axum static serving without changing business APIs.
2. Migrate music interaction playlist, now-playing, and rank to React.
3. Implement `neon`, `idol-stage`, and `vinyl` music themes.
4. Migrate non-music overlays with functionally equivalent default/compact skins.
5. Preserve legacy fallback until all smoke checks pass.
6. Remove or archive legacy static HTML only after a separate cleanup decision.

## Open Decisions Resolved

- The runtime will be React-based rather than standalone HTML.
- All current OBS pages will migrate in this project.
- Music interaction gets full multi-theme treatment in this phase.
- Other plugins migrate with equivalent visuals and basic theme hooks first.
- No custom UI editor is included in this phase.
- Effects are state-driven, not real-audio-driven.
