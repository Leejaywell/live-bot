import { createRoot } from 'react-dom/client';
import { DanmakuChatRouter } from './DanmakuChatRouter';
import './styles.css';

createRoot(document.getElementById('danmaku-chat-root')!).render(<DanmakuChatRouter />);
