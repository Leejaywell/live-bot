import voicesRaw from '../data/tts_voices.json';

export interface TtsVoice {
  id: string;
  name: string;
  description: string;
  language: string;
  gender: string;
}

export type TtsProvider = 'edge_tts' | 'minimax_tts' | 'volcano_engine' | 'cosyvoice' | 'fish_speech' | 'azure';

interface VoicesJson {
  edge_tts:       { description: string; voices: TtsVoice[] };
  minimax_tts:    { description: string; voices: TtsVoice[] };
  volcano_engine: { description: string; voices: TtsVoice[] };
  cosyvoice:      { description: string; voices: TtsVoice[] };
  fish_speech:    { description: string; voices: TtsVoice[] };
  azure:          { description: string; voices: TtsVoice[] };
}

const data = voicesRaw as unknown as VoicesJson;

export const PROVIDER_META: Record<TtsProvider, { label: string; accent: string }> = {
  edge_tts:       { label: 'Edge TTS（免费）',     accent: '#0078d4' },
  minimax_tts:    { label: 'MiniMax TTS（云端）',  accent: '#f97316' },
  volcano_engine: { label: '火山 TTS（云端）',     accent: '#ed2939' },
  cosyvoice:      { label: 'CosyVoice（本地）',    accent: '#34c759' },
  fish_speech:    { label: 'Fish Speech（本地）',  accent: '#af52de' },
  azure:          { label: 'Azure TTS',            accent: '#0078d4' },
};

/** 获取所有 voice，过滤掉无效条目（id 为空或明显不是 voice_id 的） */
export function getVoices(provider: TtsProvider): TtsVoice[] {
  const voices = (data as any)[provider]?.voices ?? [];
  return voices.filter(v => {
    if (!v.id || !v.name) return false;
    // 火山 engine 有很多脏数据，id 为纯中文描述的先过滤
    if (provider === 'volcano_engine') {
      if (!/[_/a-zA-Z]/.test(v.id)) return false;
      // 只保留含 _bigtts 或 _uranus 的 voice_type ID
      if (!v.id.includes('_bigtts') && !v.id.includes('_uranus')) return false;
    }
    return true;
  });
}

/** 获取某 provider 的所有语言 */
export function getLanguages(provider: TtsProvider): string[] {
  const langs = new Set<string>();
  for (const v of getVoices(provider)) {
    if (v.language && v.language !== '\\') langs.add(v.language);
  }
  return [...langs].sort();
}

/** 获取某 provider 的所有性别 */
export function getGenders(provider: TtsProvider, language?: string): string[] {
  const genders = new Set<string>();
  for (const v of getVoices(provider)) {
    if (language && v.language !== language) continue;
    if (v.gender) genders.add(v.gender);
  }
  return [...genders];
}

/** 过滤 voice 列表 */
export function filterVoices(
  provider: TtsProvider,
  language?: string,
  gender?: string,
): TtsVoice[] {
  return getVoices(provider).filter(v => {
    if (language && v.language !== language) return false;
    if (gender && v.gender !== gender) return false;
    return true;
  });
}

/** 从 voice_id 反向查找 voice 信息 */
export function findVoice(provider: TtsProvider, voiceId: string): TtsVoice | undefined {
  return getVoices(provider).find(v => v.id === voiceId);
}

/** 从配置的 TTS provider Name 映射到 TtsProvider key */
export function detectProvider(name: string): TtsProvider | null {
  const n = name.toLowerCase();
  if (n.includes('edge')) return 'edge_tts';
  if (n.includes('minimax')) return 'minimax_tts';
  if (n.includes('火山') || n.includes('volcengine') || n.includes('volc')) return 'volcano_engine';
  if (n.includes('cosyvoice') || n.includes('cosy')) return 'cosyvoice';
  if (n.includes('fish') && n.includes('speech')) return 'fish_speech';
  if (n.includes('azure')) return 'azure';
  return null;
}

/** 从配置的 TTS providers 的 Name 字段中提取 TtsProvider key */
export function availableProviders(names: string[]): TtsProvider[] {
  const VALID: TtsProvider[] = ['edge_tts', 'minimax_tts', 'volcano_engine'];
  const set = new Set<TtsProvider>();
  for (const name of names) {
    const k = detectProvider(name);
    if (k && (VALID as string[]).includes(k)) set.add(k);
  }
  if (set.size === 0) set.add('edge_tts'); // fallback
  return [...set];
}
