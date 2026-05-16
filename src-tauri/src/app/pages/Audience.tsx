import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search, UserPlus, Tag, Pencil, Trash2, Check, X,
  ChevronDown, ChevronUp, MessageSquare, Gift, Layers,
  AlertTriangle, RotateCcw,
} from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { api, type KnownUser } from '../lib/api';
import { toast } from 'sonner';

const AVATAR_COLORS = [
  '#4b8eff', '#34c759', '#ff9500', '#ff2d55', '#af52de',
  '#5ac8fa', '#ff6b35', '#30b0c7', '#a2845e', '#636366',
];

function avatarColor(uid: number) {
  return AVATAR_COLORS[Math.abs(uid) % AVATAR_COLORS.length];
}

function avatarChar(user: KnownUser) {
  const src = user.alias || user.nickname;
  return src ? src[0].toUpperCase() : '?';
}

function formatDate(iso: string) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 30) return `${days} 天前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '—';
  }
}

// ── modals ──────────────────────────────────────────────────────────────────

interface DeleteConfirmProps {
  user: KnownUser;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirm({ user, onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <GlassCard className="p-5 w-80 space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <div>
            <p className="text-[13px] font-bold">删除用户档案</p>
            <p className="text-[11px] text-gray-400 mt-1">
              将把 <span className="font-bold text-gray-600 dark:text-gray-200">{user.alias || user.nickname}</span> 标记为已删除，不再展示。互动历史仍会保留，可随时恢复。
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-xl text-[12px] font-bold border border-black/8 dark:border-white/10
                       text-gray-500 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-xl text-[12px] font-bold bg-red-500 text-white
                       hover:brightness-110 active:scale-95 transition-all"
          >
            确认删除
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

interface RestorePromptProps {
  existing: { nickname: string; alias: string; notes: string };
  newAlias: string;
  newNotes: string;
  onRestore: () => void;
  onCancel: () => void;
}

function RestorePrompt({ existing, newAlias, newNotes, onRestore, onCancel }: RestorePromptProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <GlassCard className="p-5 w-80 space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
            <RotateCcw className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <p className="text-[13px] font-bold">恢复已删除的用户档案</p>
            <p className="text-[11px] text-gray-400 mt-1">
              该用户曾被删除，原别名为 <span className="font-bold text-gray-600 dark:text-gray-200">{existing.alias || existing.nickname || '（无）'}</span>。
              {newAlias && newAlias !== existing.alias && (
                <> 恢复后将更新别名为 <span className="font-bold text-gray-600 dark:text-gray-200">{newAlias}</span>。</>
              )}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-xl text-[12px] font-bold border border-black/8 dark:border-white/10
                       text-gray-500 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
          >
            取消
          </button>
          <button
            onClick={onRestore}
            className="px-3 py-1.5 rounded-xl text-[12px] font-bold bg-amber-500 text-white
                       hover:brightness-110 active:scale-95 transition-all"
          >
            恢复档案
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

// ── main page ────────────────────────────────────────────────────────────────

interface EditState { uid: number; alias: string; notes: string }
interface AddState { uid: string; alias: string; notes: string }
interface DeleteTarget { user: KnownUser }
interface RestoreTarget { existing: { nickname: string; alias: string; notes: string }; newAlias: string; newNotes: string; uid: number }

export function Audience() {
  const [users, setUsers] = useState<KnownUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [add, setAdd] = useState<AddState>({ uid: '', alias: '', notes: '' });
  const [addLoading, setAddLoading] = useState(false);
  const [sortKey, setSortKey] = useState<'last_seen' | 'danmu_count' | 'gift_value'>('last_seen');
  const [sortAsc, setSortAsc] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null);
  const aliasInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setUsers(await api.getTrackedUsers(500));
    } catch (e) {
      toast.error(`加载失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (editing) setTimeout(() => aliasInputRef.current?.focus(), 50); }, [editing]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? users.filter(u =>
          u.nickname.toLowerCase().includes(q) ||
          u.alias.toLowerCase().includes(q) ||
          String(u.uid).includes(q) ||
          u.notes.toLowerCase().includes(q)
        )
      : users;
    return [...list].sort((a, b) => {
      const va = a[sortKey] ?? '';
      const vb = b[sortKey] ?? '';
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
  }, [users, search, sortKey, sortAsc]);

  const aliasCount = users.filter(u => u.alias).length;

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  // ── edit ──
  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api.updateTrackedUser(editing.uid, editing.alias, editing.notes);
      setUsers(prev => prev.map(u => u.uid === editing.uid ? { ...u, alias: editing.alias, notes: editing.notes } : u));
      setEditing(null);
      toast.success('已保存');
    } catch (e) { toast.error(`保存失败: ${e}`); }
  };

  // ── delete ──
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.softDeleteTrackedUser(deleteTarget.user.uid);
      setUsers(prev => prev.filter(u => u.uid !== deleteTarget.user.uid));
      setDeleteTarget(null);
      toast.success('已删除');
    } catch (e) { toast.error(`删除失败: ${e}`); setDeleteTarget(null); }
  };

  // ── manual add ──
  const handleAdd = async () => {
    const uid = parseInt(add.uid, 10);
    if (!uid || isNaN(uid)) { toast.error('请输入有效的 UID'); return; }
    if (!add.alias.trim()) { toast.error('别名不能为空'); return; }
    setAddLoading(true);
    try {
      const existing = await api.checkTrackedUser(uid);
      if (existing?.status === 'deleted') {
        setRestoreTarget({ existing, newAlias: add.alias.trim(), newNotes: add.notes.trim(), uid });
        setAddLoading(false);
        return;
      }
      if (existing?.status === 'active') {
        toast.error('该用户已在档案中');
        setAddLoading(false);
        return;
      }
      await api.addTrackedUser(uid, '', add.alias.trim(), add.notes.trim());
      await load();
      setAdd({ uid: '', alias: '', notes: '' });
      setShowAdd(false);
      toast.success('已添加');
    } catch (e) { toast.error(`添加失败: ${e}`); }
    setAddLoading(false);
  };

  // ── restore ──
  const confirmRestore = async () => {
    if (!restoreTarget) return;
    try {
      await api.restoreTrackedUser(restoreTarget.uid, restoreTarget.newAlias, restoreTarget.newNotes);
      await load();
      setAdd({ uid: '', alias: '', notes: '' });
      setShowAdd(false);
      setRestoreTarget(null);
      toast.success('档案已恢复');
    } catch (e) { toast.error(`恢复失败: ${e}`); setRestoreTarget(null); }
  };

  const SortBtn = ({ col, label }: { col: typeof sortKey; label: string }) => (
    <button
      onClick={() => handleSort(col)}
      className="flex items-center gap-0.5 text-[10px] font-black uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
    >
      {label}
      {sortKey === col ? (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
    </button>
  );

  return (
    <div className="p-5 space-y-4 h-full overflow-y-auto scrollbar-none">
      {/* modals */}
      {deleteTarget && (
        <DeleteConfirm user={deleteTarget.user} onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} />
      )}
      {restoreTarget && (
        <RestorePrompt
          existing={restoreTarget.existing}
          newAlias={restoreTarget.newAlias}
          newNotes={restoreTarget.newNotes}
          onRestore={confirmRestore}
          onCancel={() => setRestoreTarget(null)}
        />
      )}

      {/* header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-black tracking-tight">观众档案</h1>
          {!loading && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              共 {users.length} 位观众 · {aliasCount} 人设有别名
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索昵称 / 别名 / UID"
              className="pl-8 pr-3 py-1.5 text-[12px] rounded-xl border border-black/8 dark:border-white/10
                         bg-white/60 dark:bg-white/5 backdrop-blur-sm outline-none w-48
                         focus:border-[var(--primary-color)]/50 focus:ring-2 focus:ring-[var(--primary-color)]/10 transition-all"
            />
          </div>
          <button
            onClick={() => setShowAdd(v => !v)}
            title="手动添加观众"
            className="w-8 h-8 rounded-xl flex items-center justify-center
                       bg-[var(--primary-color)] text-white shadow-sm
                       hover:brightness-110 active:scale-95 transition-all"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* add panel */}
      {showAdd && (
        <GlassCard className="p-4 border-[var(--primary-color)]/20">
          <p className="text-[11px] font-bold text-gray-400 mb-3">
            手动添加观众别名（适合提前标记已知粉丝，礼物/关注等事件会自动入档）
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'uid', label: 'UID *', placeholder: '输入 B 站 UID' },
              { key: 'alias', label: '别名 *', placeholder: '主播称呼的名字' },
              { key: 'notes', label: '备注', placeholder: '私人备注（可选）' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
                <input
                  value={add[key as keyof AddState]}
                  onChange={e => setAdd(s => ({ ...s, [key]: e.target.value }))}
                  placeholder={placeholder}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  className="mt-1 w-full px-3 py-1.5 text-[12px] rounded-xl border border-black/8 dark:border-white/10
                             bg-white/60 dark:bg-white/5 outline-none focus:border-[var(--primary-color)]/50
                             focus:ring-2 focus:ring-[var(--primary-color)]/10 transition-all"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => { setShowAdd(false); setAdd({ uid: '', alias: '', notes: '' }); }}
              className="px-3 py-1.5 rounded-xl text-[12px] font-bold border border-black/8 dark:border-white/10
                         text-gray-500 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
            >
              取消
            </button>
            <button
              onClick={handleAdd}
              disabled={addLoading}
              className="px-3 py-1.5 rounded-xl text-[12px] font-bold bg-[var(--primary-color)] text-white
                         hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
            >
              {addLoading ? '检查中…' : '保存'}
            </button>
          </div>
        </GlassCard>
      )}

      {/* table */}
      <GlassCard className="overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_1fr_80px_80px_80px_64px] gap-4 items-center
                        px-4 py-2.5 border-b border-black/5 dark:border-white/5">
          <div className="w-8" />
          <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">昵称 / 别名</span>
          <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">备注</span>
          <SortBtn col="danmu_count" label="弹幕" />
          <SortBtn col="gift_value" label="礼物" />
          <SortBtn col="last_seen" label="最近" />
          <div />
        </div>

        {loading && <div className="py-12 text-center text-[12px] text-gray-400">加载中…</div>}
        {!loading && filtered.length === 0 && (
          <div className="py-12 text-center text-[12px] text-gray-400">
            {search ? '没有匹配的观众' : '暂无档案，礼物/关注/3 条弹幕后自动入档'}
          </div>
        )}

        {!loading && filtered.map(user => {
          const isEditing = editing?.uid === user.uid;
          const color = avatarColor(user.uid);

          return (
            <div
              key={user.uid}
              className="grid grid-cols-[auto_1fr_1fr_80px_80px_80px_64px] gap-4 items-center
                         px-4 py-3 border-b border-black/4 dark:border-white/4 last:border-0
                         hover:bg-black/2 dark:hover:bg-white/2 transition-colors group"
            >
              {/* avatar */}
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-[12px] font-black shrink-0"
                style={{ background: color }}
              >
                {(user.alias || user.nickname || '?')[0].toUpperCase()}
              </div>

              {/* name + alias */}
              <div className="min-w-0">
                {isEditing ? (
                  <input
                    ref={aliasInputRef}
                    value={editing.alias}
                    onChange={e => setEditing(s => s && { ...s, alias: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                    placeholder="别名"
                    className="w-full px-2 py-1 text-[12px] rounded-lg border border-[var(--primary-color)]/40
                               bg-white/80 dark:bg-white/10 outline-none focus:ring-2 focus:ring-[var(--primary-color)]/20"
                  />
                ) : (
                  <>
                    {user.alias && (
                      <div className="flex items-center gap-1">
                        <Tag className="w-3 h-3 shrink-0" style={{ color }} />
                        <span className="text-[13px] font-bold truncate">{user.alias}</span>
                      </div>
                    )}
                    <div className={`truncate ${user.alias ? 'text-[11px] text-gray-400' : 'text-[13px] font-bold'}`}>
                      {user.nickname || `UID ${user.uid}`}
                    </div>
                    <div className="text-[10px] text-gray-400">{user.uid}</div>
                  </>
                )}
              </div>

              {/* notes */}
              <div className="min-w-0">
                {isEditing ? (
                  <input
                    value={editing.notes}
                    onChange={e => setEditing(s => s && { ...s, notes: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                    placeholder="备注（可选）"
                    className="w-full px-2 py-1 text-[12px] rounded-lg border border-[var(--primary-color)]/40
                               bg-white/80 dark:bg-white/10 outline-none focus:ring-2 focus:ring-[var(--primary-color)]/20"
                  />
                ) : (
                  <span className="text-[11px] text-gray-400 truncate block">{user.notes || '—'}</span>
                )}
              </div>

              {/* danmu */}
              <div className="flex items-center gap-1 text-[12px] font-bold text-gray-600 dark:text-gray-300">
                <MessageSquare className="w-3 h-3 text-gray-400 shrink-0" />
                {user.danmu_count.toLocaleString()}
              </div>

              {/* gift */}
              <div className="flex items-center gap-1 text-[12px] font-bold text-gray-600 dark:text-gray-300">
                <Gift className="w-3 h-3 text-gray-400 shrink-0" />
                {user.gift_value > 0 ? user.gift_value.toLocaleString() : '—'}
              </div>

              {/* sessions · last seen */}
              <div className="flex items-center gap-1 text-[11px] text-gray-400">
                <Layers className="w-3 h-3 shrink-0" />
                <span>{user.session_count}</span>
                <span className="mx-0.5 text-gray-300">·</span>
                <span>{formatDate(user.last_seen)}</span>
              </div>

              {/* actions */}
              <div className="flex items-center justify-end gap-1">
                {isEditing ? (
                  <>
                    <button
                      onClick={saveEdit}
                      className="w-6 h-6 rounded-lg flex items-center justify-center
                                 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="w-6 h-6 rounded-lg flex items-center justify-center
                                 bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-black/10 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setEditing({ uid: user.uid, alias: user.alias, notes: user.notes })}
                      className="w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100
                                 text-gray-400 hover:text-[var(--primary-color)] hover:bg-[var(--primary-color)]/10 transition-all"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget({ user })}
                      className="w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100
                                 text-gray-400 hover:text-red-500 hover:bg-red-500/10 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </GlassCard>
    </div>
  );
}
