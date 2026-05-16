import { useEffect, useRef, useState } from 'react';
import { X, Anchor, Star, Crown } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

// ─── 类型 ────────────────────────────────────────────────────────────────────

interface ScItem {
  id: number;
  user: string;
  price: number;
  text: string;
  exiting: boolean;
}

interface GuardItem {
  id: number;
  user: string;
  gift: string;
  exiting: boolean;
}

let _oid = 0;

// ─── SC 醒目留言浮层 ──────────────────────────────────────────────────────────

function ScBanner({ item, onDone }: { item: ScItem; onDone: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDone, 8000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [onDone]);

  const priceColor =
    item.price >= 500 ? '#ff4444' :
    item.price >= 100 ? '#ff8800' :
    item.price >= 30  ? '#ffb300' : '#f5c842';

  const gradFrom =
    item.price >= 500 ? 'rgba(255,44,44,0.18)' :
    item.price >= 100 ? 'rgba(255,136,0,0.16)' :
    item.price >= 30  ? 'rgba(255,179,0,0.14)' : 'rgba(245,200,66,0.12)';

  return (
    <div
      className={cn(
        'relative w-full max-w-[560px] rounded-2xl overflow-hidden border border-white/20 shadow-2xl backdrop-blur-xl',
        item.exiting ? 'animate-sc-out' : 'animate-sc-in',
      )}
      style={{ background: `linear-gradient(135deg, ${gradFrom}, rgba(20,16,10,0.82))` }}
    >
      {/* 顶部进度条 */}
      <div
        className="absolute top-0 left-0 h-[3px] rounded-full"
        style={{ background: priceColor, width: '100%', animation: 'toast-progress 8s linear forwards' }}
      />

      <div className="px-5 py-4">
        {/* 头部：标签 + 用户 + 金额 + 关闭 */}
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[10px] font-black px-2 py-0.5 rounded-full"
            style={{ background: priceColor, color: '#fff' }}
          >
            醒目留言
          </span>
          <span className="text-[13px] font-black text-white flex-1 truncate">{item.user}</span>
          <span className="text-[13px] font-black shrink-0" style={{ color: priceColor }}>
            ¥{item.price}
          </span>
          <button
            onClick={onDone}
            className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-3 h-3 text-white/70" />
          </button>
        </div>
        {/* 留言内容 */}
        <p className="text-[13px] text-white/90 leading-relaxed break-all font-medium">{item.text}</p>
      </div>
    </div>
  );
}

// ─── 大航海入场横幅 ───────────────────────────────────────────────────────────

const GUARD_META: Record<string, { label: string; color: string; bg: string; Icon: typeof Crown }> = {
  '总督': { label: '总督', color: '#c084fc', bg: 'rgba(192,132,252,0.18)', Icon: Crown },
  '提督': { label: '提督', color: '#60a5fa', bg: 'rgba(96,165,250,0.16)', Icon: Star },
  '舰长': { label: '舰长', color: '#34d399', bg: 'rgba(52,211,153,0.14)', Icon: Anchor },
};

function GuardBanner({ item, onDone }: { item: GuardItem; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4500);
    return () => clearTimeout(t);
  }, [onDone]);

  const meta = GUARD_META[item.gift] ?? GUARD_META['舰长'];
  const { label, color, bg, Icon } = meta;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-5 py-3 rounded-2xl border border-white/15 shadow-xl backdrop-blur-xl',
        item.exiting ? 'animate-guard-out' : 'animate-guard-in',
      )}
      style={{ background: `linear-gradient(90deg, ${bg}, rgba(10,10,20,0.80))` }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `${color}22`, border: `1.5px solid ${color}55` }}
      >
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-[13px] font-black text-white truncate">{item.user}</span>
        <span className="text-[11px] text-white/60 shrink-0">开通了</span>
        <span
          className="text-[11px] font-black px-2 py-0.5 rounded-full shrink-0"
          style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
        >
          {label}
        </span>
      </div>
      <button
        onClick={onDone}
        className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors shrink-0"
      >
        <X className="w-3 h-3 text-white/50" />
      </button>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function DanmuOverlay() {
  const [scQueue, setScQueue]     = useState<ScItem[]>([]);
  const [guards, setGuards]       = useState<GuardItem[]>([]);

  useEffect(() => {
    const handleBatch = (batch: any[]) => {
      for (const parsed of batch) {
        const ev = parsed.event as Record<string, any>;
        if (ev.type === 'SuperChat') {
          const item: ScItem = { id: _oid++, user: ev.user, price: ev.price ?? 0, text: ev.text ?? '', exiting: false };
          setScQueue(q => [...q, item].slice(-5));
        }
        if (ev.type === 'GuardBuy') {
          const item: GuardItem = { id: _oid++, user: ev.user, gift: ev.gift ?? '舰长', exiting: false };
          setGuards(g => [...g, item].slice(-3));
        }
      }
    };

    let unlistenBatch: (() => void) | undefined;
    let unlistenSingle: (() => void) | undefined;
    api.onLiveEvents(handleBatch).then(f => { unlistenBatch = f; }).catch(() => {});
    api.onLiveEvent((p) => handleBatch([p])).then(f => { unlistenSingle = f; }).catch(() => {});
    return () => { unlistenBatch?.(); unlistenSingle?.(); };
  }, []);

  const dismissSc = (id: number) => {
    setScQueue(q => q.map(item => item.id === id ? { ...item, exiting: true } : item));
    setTimeout(() => setScQueue(q => q.filter(item => item.id !== id)), 300);
  };

  const dismissGuard = (id: number) => {
    setGuards(g => g.map(item => item.id === id ? { ...item, exiting: true } : item));
    setTimeout(() => setGuards(g => g.filter(item => item.id !== id)), 300);
  };

  if (scQueue.length === 0 && guards.length === 0) return null;

  return (
    <>
      {/* 大航海横幅 — 顶部 */}
      {guards.length > 0 && (
        <div className="fixed top-[64px] left-0 right-0 z-[9000] flex flex-col items-center gap-2 px-4 pt-2 pointer-events-none">
          {guards.map(item => (
            <div key={item.id} className="pointer-events-auto w-full max-w-[420px]">
              <GuardBanner item={item} onDone={() => dismissGuard(item.id)} />
            </div>
          ))}
        </div>
      )}

      {/* SC 浮层 — 底部 */}
      {scQueue.length > 0 && (
        <div className="fixed bottom-6 left-0 right-0 z-[9000] flex flex-col items-center gap-2 px-4 pointer-events-none">
          {scQueue.map(item => (
            <div key={item.id} className="pointer-events-auto w-full max-w-[560px]">
              <ScBanner item={item} onDone={() => dismissSc(item.id)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
