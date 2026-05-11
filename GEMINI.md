# Streamix (Live Bot) Project Context

This file provides foundational mandates and project context for AI agents working on the Streamix codebase. Streamix is a high-performance Bilibili live stream assistant built with Rust and Tauri.

## Project Overview

Streamix (formerly Live Bot) is an AI-powered assistant for Bilibili streamers. It provides real-time monitoring, automated interaction (welcomes, thanks, keyword replies), and advanced AI Agent capabilities.

### Core Architecture
- **Frontend**: React (TypeScript) + Vite, running within the Tauri shell. Located in `src-tauri/`.
- **Backend (Tauri Commands)**: Rust-based Tauri commands that interface with the bot logic. Located in `src/main.rs`.
- **Bot Logic**: Modular engine for processing live events. Located in `src/bot/`.
- **API Integration**: Bilibili-specific HTTP and WebSocket protocol implementations.
  - `src/api.rs`: Bilibili HTTP API (login, room info, etc.).
  - `crates/bilibili-live-protocol`: Custom crate for parsing Bilibili WebSocket events.
- **Voice Capabilities**: Specialized crate for ASR (Speech-to-Text) and TTS (Text-to-Speech). Located in `crates/voice/`.
- **Storage**: SQLite-based persistence for interaction records and sessions. Located in `src/storage/`.

## Building and Running

### Prerequisites
- Rust (Stable)
- Node.js (Latest LTS)
- pnpm (Recommended)

### Commands
- **Run Development Mode**: `cargo run --features tauri` (Starts both the Rust backend and Vite frontend).
- **Build Frontend**: `npm run build` inside `src-tauri/`.
- **Build Release Binary**: `cargo build --release --features tauri`.
- **Run Tests**: `cargo test --workspace`.
- **Linting**: `cargo fmt --check` and `npm run lint` inside `src-tauri/`.

## Development Conventions

### Backend (Rust)
- **Async/Await**: Heavy use of `tokio` for asynchronous task management.
- **Error Handling**: Use `anyhow` for flexible error propagation in application logic.
- **Feature Flags**: The `tauri` feature flag controls the inclusion of the desktop GUI components.
- **Event Handling**: Live events are processed through `BotEngine::handle_event`, which returns a vector of response strings.

### Frontend (React/TS)
- **Styling**: Tailwind CSS v4 with specialized "Liquid Glass" glassmorphism effects.
- **State Management**: React state and hooks, with Tauri `invoke` for backend communication.
- **UI Components**: Uses Radix UI primitives and Lucide icons.

### Data Management
- **Persistence**: SQLite is used for all long-term data.
- **Credentials**: Bilibili tokens and refresh tokens are stored in the `token/` directory.
- **Configuration**: Application configuration is stored in `etc/bilidanmaku-api.yaml`.

## Key Files & Directories
- `src/main.rs`: The heartbeat of the application, managing the Tauri lifecycle and command registration.
- `src/bot/engine.rs`: The central logic for filtering and responding to live events.
- `src/api.rs`: The gateway to Bilibili's web services.
- `crates/bilibili-live-protocol/src/lib.rs`: The parser for Bilibili's live binary protocol.
- `docs/roadmap.md`: The strategic plan for the project's evolution.
