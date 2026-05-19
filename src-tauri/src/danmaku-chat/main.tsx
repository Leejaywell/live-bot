import { createRoot } from 'react-dom/client';
import { DanmakuChatRouter } from './DanmakuChatRouter';
import './styles.css';

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

createRoot(document.getElementById('danmaku-chat-root')!).render(<DanmakuChatRouter />);
