import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Volume2, X, Mic } from 'lucide-react';
import { TtsProvider, TtsVoice, getLanguages, filterVoices, PROVIDER_META } from '../lib/voices';
import { cn } from '../lib/utils';

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
    if (open) { setRendered(true); setClosing(false); }
    else if (rendered) {
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
        className={cn('relative w-[420px] max-h-[520px] glass-card rounded-[18px] backdrop-blur-xl shadow-2xl border border-white/60 dark:border-white/10 flex flex-col overflow-hidden', closing ? 'animate-modal-out' : 'animate-modal-in')}>
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
          {/* Provider tabs */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-gray-200/60 dark:bg-white/8">
            {providers.map(k => (
              <button key={k} onClick={() => { setProvider(k); setLang(''); setGender(''); }}
                className={cn('h-[24px] px-2.5 rounded-md text-[10px] font-medium transition-all',
                  provider === k ? 'bg-white dark:bg-white/20 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {PROVIDER_META[k].label.replace(' TTS', '').replace('（免费）','').replace('（云端）','')}
              </button>
            ))}
          </div>
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
                    <span className="font-mono truncate">{v.id}</span>
                    {v.description && <span>· {v.description}</span>}
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
