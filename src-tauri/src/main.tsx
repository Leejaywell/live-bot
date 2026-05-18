import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { ChatOverlay } from "./app/pages/ChatOverlay.tsx";
import "./styles/index.css";

// Detect overlay window: try Tauri metadata first, fall back to hash
const isOverlay = (() => {
  try {
    const label = (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label
      ?? (window as any).__TAURI__?.metadata?.currentWindow?.label;
    if (label) return label === 'danmu-overlay';
  } catch {}
  // Fallback: main window opens plain index.html; overlay sets hash
  return location.hash === '#overlay';
})();

// Synchronously clear the index.html background colour before React renders,
// so the overlay window never shows a white frame even for one frame.
if (isOverlay) {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}

createRoot(document.getElementById("root")!).render(
  isOverlay ? <ChatOverlay /> : <App />
);
