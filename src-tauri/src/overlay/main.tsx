import { createRoot } from 'react-dom/client';
import { OverlayRouter } from './OverlayRouter';
import './styles.css';

createRoot(document.getElementById('danmaku-chat-root')!).render(<OverlayRouter />);
