import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Volume2, X, Mic } from 'lucide-react';
import { TtsProvider, TtsVoice, getLanguages, getVoices, filterVoices, PROVIDER_META } from '../lib/voices';
import { cn } from '../lib/utils';
import { MODAL_W } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  providers: TtsProvider[];
  currentVoice: string;
  onSelect: (voiceId: string) => void;
}

export function VoicePicker({ open, onClose, providers, currentVoice, onSelect }: Props) {
  const [provider, setProvider] = useState<TtsProvider>(providers[0] ?? 'edge_tts');
  const [lang, setLang] = useState('');
  const [gender, setGender] = useState('');
  const [search, setSearch] = useState('');
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRendered(true); setClosing(false);
      // 根据当前声音恢复到对应服务商
      for (const p of providers) {
        const v = getVoices(p).find(voice => voice.id === currentVoice);
        if (v) { setProvider(p); break; }
      }
    } else if (rendered) {
      setClosing(true);
      const t = setTimeout(() => { setRendered(false); setClosing(false); }, 220);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (providers.length > 0 && !providers.includes(provider)) setProvider(providers[0]);
  }, [providers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const voices = filterVoices(provider, lang || undefined, gender || undefined)
    .filter(v => !search || v.name.toLowerCase().includes(search.toLowerCase()) || v.id.toLowerCase().includes(search.toLowerCase()));

  const langs = getLanguages(provider);
  const genders = [...new Set(filterVoices(provider, lang || undefined).map(v => v.gender).filter(Boolean))];

  if (!rendered) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center" onClick={onClose}>
      <div className={cn('absolute inset-0 bg-black/30 backdrop-blur-sm', closing ? 'animate-backdrop-out' : 'animate-backdrop-in')} />
      <div ref={ref} onClick={e => e.stopPropagation()}
        className={cn('relative max-h-[520px] glass-card rounded-[18px] backdrop-blur-xl shadow-2xl border border-white/60 dark:border-white/10 flex flex-col overflow-hidden', MODAL_W, closing ? 'animate-modal-out' : 'animate-modal-in')}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-[var(--primary-color)]" />
            <span className="text-[12px] font-semibold">选择 TTS 声音</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-white/20 dark:bg-white/5 shrink-0 flex-wrap">
          {/* Provider select */}
          <select value={provider} onChange={e => { setProvider(e.target.value as TtsProvider); setLang(''); setGender(''); }}
            className="h-[24px] pl-1.5 pr-5 rounded-lg text-[10px] bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]/40 appearance-none"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M0 2l4 4 4-4' fill='%23999'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center' }}>
            {providers.map(k => (
              <option key={k} value={k}>{PROVIDER_META[k].label}</option>
            ))}
          </select>
          {/* Lang */}
          {langs.length > 0 && (
            <select value={lang} onChange={e => { setLang(e.target.value); setGender(''); }}
              className="h-[24px] pl-1.5 pr-4 rounded-lg text-[10px] bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]/40">
              <option value="">全部语言</option>
              {langs.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          {/* Gender */}
          {genders.length > 0 && (
            <select value={gender} onChange={e => setGender(e.target.value)}
              className="h-[24px] pl-1.5 pr-4 rounded-lg text-[10px] bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]/40">
              <option value="">全部</option>
              {genders.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          {/* Search */}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索..."
            className="flex-1 min-w-[60px] h-[24px] pl-2 pr-2 rounded-lg text-[10px] bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]/40" />
        </div>

        {/* Voice list */}
        <div className="flex-1 overflow-y-auto p-2">
          {voices.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-[11px] text-gray-400">没有匹配的声音</div>
          ) : (
            voices.map(v => (
              <button key={v.id}
                onClick={() => { onSelect(v.id); onClose(); }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors hover:bg-black/5 dark:hover:bg-white/8',
                  currentVoice === v.id ? 'bg-[var(--primary-color)]/8 border border-[var(--primary-color)]/20' : 'border border-transparent',
                )}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium truncate">{v.name}</span>
                    {currentVoice === v.id && (
                      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--primary-color)]" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[9px] text-gray-400 mt-0.5">
                    {v.description && <span className="truncate">{v.description}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[9px] text-gray-400">{v.language}</span>
                  <span className={cn('text-[9px] px-1 py-0.5 rounded', v.gender === '女' ? 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400')}>
                    {v.gender}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
