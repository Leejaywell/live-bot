import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Radio,
  MessageSquare,
  Bot,
  Mic,
  Cpu,
  BarChart3,
  Settings as SettingsIcon,
  Moon,
  Sun,
  ChevronLeft,
} from 'lucide-react';
import logoUrl from '../../assets/logo.svg?url';
import { IconButton } from './IconButton';
import { cn } from '../lib/utils';
import { useTheme } from '../context/ThemeContext';

interface SidebarProps {
  collapsed?: boolean;
  connected?: boolean;
  onToggleThemePanel?: () => void;
  onToggleSidebar?: () => void;
  onToggleSettings?: () => void;
  onBlockedClick?: () => void;
}

const navItems = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard, mt: true },
  { path: '/stats', label: '数据统计', icon: BarChart3 },
  { path: '/monitor', label: '弹幕管理', icon: Radio },
  { path: '/auto-reply', label: '自动回复', icon: MessageSquare },
  { path: '/ai', label: 'AI 机器人', icon: Bot },
  { path: '/voice', label: '语音交互', icon: Mic },
  { path: '/models', label: '模型服务', icon: Cpu },
];

// Known dimensions (must match Tailwind classes below)
const ITEM_H   = 42; // h-[42px]
const ITEM_GAP = 4;  // space-y-1
const FIRST_MT = 6;  // mt-1.5 on item 0

export function Sidebar({ collapsed, connected, onToggleThemePanel, onToggleSidebar, onToggleSettings, onBlockedClick }: SidebarProps) {
  const location = useLocation();
  const { theme } = useTheme();

  const activeIdx = navItems.findIndex(item => item.path === location.pathname);
  const indicatorTop = FIRST_MT + activeIdx * (ITEM_H + ITEM_GAP);

  const handleNavClick = (e: React.MouseEvent) => {
    if (!connected) {
      e.preventDefault();
      onBlockedClick?.();
    }
  };

  return (
    <div
      className={cn(
        'h-full glass-sidebar backdrop-blur-xl overflow-hidden shrink-0',
        'transition-[width,opacity] duration-300 ease-in-out',
        collapsed ? 'w-0 opacity-0 pointer-events-none' : 'w-[196px] opacity-100',
      )}
    >
      {/* Fixed-width inner so content never wraps during collapse */}
      <div className="w-[196px] h-full flex flex-col pb-3.5 px-3.5">
        <div className="flex items-center justify-between px-2 h-[56px] flex-shrink-0">
          <div className="flex items-center gap-2">
            <img src={logoUrl} alt="流光" className="w-[28px] h-[28px] rounded-lg" />
            <span className="font-bold text-[14px] whitespace-nowrap">流光</span>
          </div>
          <IconButton onClick={onToggleSidebar} className="opacity-60 hover:opacity-100">
            <ChevronLeft className="w-4 h-4" />
          </IconButton>
        </div>

        <nav className="flex-1 space-y-1 mt-5 relative">
          {/* Sliding active indicator */}
          {activeIdx >= 0 && (
            <div
              className="absolute left-0 right-0 rounded-[12px] pointer-events-none"
              style={{
                top: indicatorTop,
                height: ITEM_H,
                background: 'var(--primary-color)',
                boxShadow: '0 8px 16px -4px rgba(var(--primary-rgb), 0.4)',
                transition: 'top 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          )}

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={handleNavClick}
                className={cn(
                  'flex items-center gap-3 h-[42px] px-3 rounded-[12px] relative z-10 group',
                  'transition-colors duration-200',
                  item.mt && 'mt-1.5',
                  isActive
                    ? 'text-white'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-white/5'
                )}
              >
                <Icon className={cn('w-[20px] h-[20px] transition-transform duration-300', !isActive && 'group-hover:scale-110')} />
                <span className="text-[13px] font-black flex-1 tracking-tight whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="pt-3 border-t border-white/10 flex gap-2 flex-shrink-0">
          <IconButton onClick={onToggleSettings}>
            <SettingsIcon className="w-4 h-4" />
          </IconButton>
          <IconButton onClick={onToggleThemePanel}>
            {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </IconButton>
        </div>
      </div>
    </div>
  );
}
