import { Link, useLocation } from 'react-router-dom';
import { useRef, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Radio,
  MessageSquare,
  Bot,
  Mic,
  Cpu,
  BarChart3,
  Users2,
  Settings as SettingsIcon,
  Plug,
  Moon,
  Sun,
  Sparkles,
} from 'lucide-react';
import logoUrl from '../../assets/logo.svg?url';
import { IconButton } from './IconButton';
import { cn } from '../lib/utils';
import { useTheme } from '../context/ThemeContext';
import { useRoom } from '../context/RoomContext';

export type SidebarMode = 'expanded' | 'icon' | 'hidden';

interface SidebarProps {
  mode?: SidebarMode;
  onToggleThemePanel?: () => void;
  onToggleSidebar?: () => void;
  onToggleSettings?: () => void;
}

const navItems = [
  { path: '/', label: '直播概览', icon: LayoutDashboard },
  { path: '/audience', label: '观众档案', icon: Users2 },
  { path: '/stats', label: '数据统计', icon: BarChart3 },
  { path: '/auto-reply', label: '触发回复', icon: MessageSquare },
  { path: '/monitor', label: '实时弹幕', icon: Radio, requiresRoom: true },
  { path: '/ai', label: '智能助手', icon: Bot },
  { path: '/voice', label: '语音陪伴', icon: Mic },
  { path: '/voice-changer', label: '语音变声', icon: Sparkles },
  { path: '/models', label: '模型管理', icon: Cpu },
  {
    path: '/plugins/chat-overlay',
    pathPrefix: '/plugins',
    label: '插件中心',
    icon: Plug,
    children: [
      { path: '/plugins/chat-overlay', label: '弹幕聊天' },
      { path: '/plugins/wish-goal', label: '心愿目标' },
      { path: '/plugins/lottery', label: '抽奖互动' },
      { path: '/plugins/gift-effect', label: '礼物特效' },
      { path: '/plugins/recent-gifts', label: '最近礼物' },
      { path: '/plugins/gift-rank', label: '礼物排行' },
    ],
  },
];

export function Sidebar({ mode = 'expanded', onToggleThemePanel, onToggleSidebar, onToggleSettings }: SidebarProps) {
  const location = useLocation();
  const { theme } = useTheme();
  const { connected, requireRoom } = useRoom();
  const navRef = useRef<HTMLElement>(null);
  const [indicatorTop, setIndicatorTop] = useState(0);
  const [indicatorVisible, setIndicatorVisible] = useState(false);
  const iconOnly = mode === 'icon';

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const activeLink = nav.querySelector('[data-active="true"]') as HTMLElement | null;
    if (activeLink) {
      const navRect = nav.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      setIndicatorTop(linkRect.top - navRect.top);
      setIndicatorVisible(true);
    } else {
      setIndicatorVisible(false);
    }
  }, [location.pathname, mode]);

  const handleNavClick = (e: React.MouseEvent, requiresRoom?: boolean) => {
    if (requiresRoom && !connected) {
      e.preventDefault();
      requireRoom();
    }
  };

  return (
    <div
      className={cn(
        'h-full glass-sidebar backdrop-blur-xl overflow-hidden shrink-0',
        'transition-[width,opacity] duration-300 ease-in-out',
        mode === 'hidden' ? 'w-0 opacity-0 pointer-events-none'
          : mode === 'icon' ? 'w-[56px] opacity-100'
          : 'w-[172px] opacity-100',
      )}
    >
      <div className={cn(
        'h-full flex flex-col pb-3.5 transition-[padding,width] duration-300 ease-in-out',
        iconOnly ? 'w-[56px] px-1.5' : 'w-[172px] px-3.5',
      )}>
        {/* Logo — 点击切换展开/收起 */}
        <div
          onClick={onToggleSidebar}
          className={cn(
            'flex items-center h-[56px] flex-shrink-0 cursor-pointer select-none',
            'rounded-xl transition-colors duration-200 hover:bg-[var(--button-ghost-hover)]',
            iconOnly ? 'justify-center' : 'px-2 gap-2',
          )}
        >
          <img src={logoUrl} alt="流光" className="w-[34px] h-[34px] rounded-xl" />
          {!iconOnly && (
            <span className="font-black text-[15px] whitespace-nowrap tracking-tight">流光</span>
          )}
        </div>

        {/* Nav */}
        <nav ref={navRef} className="flex-1 flex flex-col gap-[4px] pt-[6px] mt-5 relative">
          {indicatorVisible && (
            <div
              className="absolute left-0 right-0 rounded-[12px] pointer-events-none"
              style={{
                top: indicatorTop,
                height: 42,
                background: 'var(--primary-color)',
                boxShadow: '0 8px 16px -4px rgba(var(--primary-rgb), 0.4)',
                transition: 'top 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          )}

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.pathPrefix ? location.pathname.startsWith(item.pathPrefix) : location.pathname === item.path;
            const disabled = !connected && !!item.requiresRoom;

            return (
              <div key={item.path} className="relative z-10">
                <Link
                  to={item.path}
                  data-active={String(isActive)}
                  onClick={(e) => handleNavClick(e, item.requiresRoom)}
                  title={iconOnly ? item.label : undefined}
                  className={cn(
                    'flex items-center h-[42px] rounded-[12px] group',
                    'transition-colors duration-200',
                    iconOnly ? 'justify-center px-0' : 'gap-3 px-3',
                    isActive
                      ? 'text-white'
                      : disabled
                      ? 'text-gray-400 dark:text-gray-600 opacity-50 cursor-not-allowed'
                      : 'text-gray-800 dark:text-gray-100 hover:text-gray-900 dark:hover:text-white hover:bg-[var(--button-ghost-hover)]',
                  )}
                >
                  <Icon className={cn(
                    'w-[15px] h-[15px] transition-transform duration-300 shrink-0',
                    !isActive && !disabled && 'group-hover:scale-110',
                  )} />
                  {!iconOnly && (
                    <span className="text-[13px] font-black flex-1 tracking-tight whitespace-nowrap">{item.label}</span>
                  )}
                </Link>
                {!iconOnly && item.children && isActive && (
                  <div className="mt-1 ml-[27px] flex flex-col gap-1 border-l border-white/10 pl-2">
                    {item.children.map((child) => {
                      const childActive = location.pathname === child.path;
                      return (
                        <Link
                          key={child.path}
                          to={child.path}
                          className={cn(
                            'h-[28px] rounded-lg px-2 flex items-center text-[11px] font-bold transition-colors',
                            childActive
                              ? 'bg-[var(--button-ghost-hover)] text-[var(--primary-color)]'
                              : 'text-gray-500 dark:text-gray-400 hover:bg-[var(--button-ghost-hover)] hover:text-gray-800 dark:hover:text-gray-100',
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={cn(
          'pt-3 border-t border-white/10 flex flex-shrink-0',
          iconOnly ? 'flex-col items-center gap-1' : 'items-center gap-1',
        )}>
          {iconOnly ? (
            <>
              <IconButton onClick={onToggleThemePanel} title={theme === 'dark' ? '暗色模式' : '亮色模式'} className="w-9 h-9">
                {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </IconButton>
              <IconButton onClick={onToggleSettings} title="设置" className="w-9 h-9">
                <SettingsIcon className="w-4 h-4" />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton onClick={onToggleSettings} title="设置" className="w-9 h-9">
                <SettingsIcon className="w-4 h-4" />
              </IconButton>
              <IconButton onClick={onToggleThemePanel} title={theme === 'dark' ? '暗色模式' : '亮色模式'} className="w-9 h-9">
                {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </IconButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
