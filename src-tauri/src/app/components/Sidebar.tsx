import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Radio,
  MessageSquare,
  Bot,
  BarChart3,
  Swords,
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
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/monitor', label: '弹幕管理', icon: Radio },
  { path: '/auto-reply', label: '自动回复', icon: MessageSquare },
  { path: '/ai', label: 'AI 机器人', icon: Bot },
  { path: '/stats', label: '数据统计', icon: BarChart3, wip: true },
  { path: '/pk', label: 'PK 与活动', icon: Swords, wip: true },
];

export function Sidebar({ collapsed, connected, onToggleThemePanel, onToggleSidebar, onToggleSettings, onBlockedClick }: SidebarProps) {
  const location = useLocation();
  const { theme } = useTheme();

  if (collapsed) return null;

  const handleNavClick = (e: React.MouseEvent) => {
    if (!connected) {
      e.preventDefault();
      onBlockedClick?.();
    }
  };

  return (
    <div className="w-[196px] h-full glass-sidebar backdrop-blur-xl flex flex-col pb-3.5 px-3.5">
      <div className="flex items-center justify-between mb-2 px-2 h-[52px] flex-shrink-0">
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="流光" className="w-[28px] h-[28px] rounded-lg" />
          <span className="font-bold text-[14px]">流光</span>
        </div>
        <IconButton onClick={onToggleSidebar} className="opacity-60 hover:opacity-100">
          <ChevronLeft className="w-4 h-4" />
        </IconButton>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={handleNavClick}
              className={cn(
                'flex items-center gap-3 h-[44px] px-3 rounded-xl transition-all',
                isActive
                  ? 'bg-gradient-to-br from-[var(--primary-color)]/20 to-[var(--primary-color)]/15 border border-[var(--primary-color)]/30'
                  : 'hover:bg-white/20 dark:hover:bg-white/5'
              )}
            >
              {isActive && (
                <div
                  className="w-[28px] h-[28px] rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--primary-color)', color: 'white' }}
                >
                  <Icon className="w-4 h-4" />
                </div>
              )}
              {!isActive && <Icon className="w-4 h-4 ml-1" />}
              <span className="text-[12px] font-medium flex-1" style={isActive ? { color: 'var(--primary-color)' } : {}}>{item.label}</span>
              {item.wip && (
                <span className="text-[9px] text-gray-400 dark:text-gray-500 font-normal">待开发</span>
              )}
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
  );
}
