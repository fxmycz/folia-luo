import React, { useState } from 'react';
import { ListChecks, Pencil, Plus, RefreshCw, Trash } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { SongResult } from '../../../types';
import ThemedDialog from '../../../components/shared/ThemedDialog';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { useLuoxueLibraryStore, type LuoxueSavedCollection, type LuoxueUserList } from '../../store/useLuoxueLibraryStore';
import { loadLuoxueCollectionSnapshot } from '../../services/collectionSnapshot';
import LuoxueSplitBrowser from '../LuoxueSplitBrowser';
import LuoxueSelectableSongList from '../LuoxueSelectableSongList';
import type { LuoxuePlaybackCallbacks } from '../LuoxueSongList';

// src/luoxue/components/panels/LuoxueMyListPanel.tsx
// 我的列表面板：左栏是选项树，右栏是选中项的曲目与动作。
// 左栏结构：播放历史 → 收藏（分组：默认的「我的收藏」+ 用户自建列表 + 新建）→ 收藏的歌单（分组）。
// 「收藏」「收藏的歌单」本身是不可选中的分组标题，子项缩进一级，层级一眼可见。
// 「收藏的歌单」存的是收藏那一刻的歌单快照（不随上游更新），要同步上游就点右栏的「更新」。

type LuoxueMyListPanelProps = LuoxuePlaybackCallbacks;

/** 左栏叶子项 / 分组标题的通用样式：选中态用强调色 + 底色，未选中压暗。 */
const sidebarItemClass = (active: boolean): string => [
    'flex w-full min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
    active ? 'border-transparent bg-current/10' : 'border-current/10 enabled:hover:bg-current/5',
].join(' ');

/** 头部跟随文字的按钮（播放全部 / 管理 / 更新 / 删除 / 清空共用一套样式）。 */
const headerButtonClass = 'rounded-full px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40';

/** 时间戳 → 「2026/10/18」；缺失时返回空串。 */
const formatSavedTime = (timestamp?: number): string => (
    timestamp ? new Date(timestamp).toLocaleDateString('zh-CN') : ''
);

/** 左栏里的固定键：默认那份「我的收藏」和播放历史（自建列表用 'fav:<id>'，收藏的歌单用 'col:<id>'）。 */
const FAVORITES_KEY = 'fav:default';
const HISTORY_KEY = 'history';

const LuoxueMyListPanel: React.FC<LuoxueMyListPanelProps> = ({ isInteractive, onPlaySong, onAddSongToQueue, onPlayAll }) => {
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const {
        favorites, history, lists, collections,
        clearFavorites, clearHistory, removeFavoriteSongs,
        removeHistorySongs, createList, renameList, removeList, removeUserListSongs,
        removeCollection, removeCollectionSongs, saveCollection,
    } = useLuoxueLibraryStore(useShallow(state => ({
        favorites: state.favorites,
        history: state.history,
        lists: state.lists,
        collections: state.collections,
        clearFavorites: state.clearFavorites,
        clearHistory: state.clearHistory,
        removeFavoriteSongs: state.removeFavoriteSongs,
        removeHistorySongs: state.removeHistorySongs,
        createList: state.createList,
        renameList: state.renameList,
        removeList: state.removeList,
        removeUserListSongs: state.removeUserListSongs,
        removeCollection: state.removeCollection,
        removeCollectionSongs: state.removeCollectionSongs,
        saveCollection: state.saveCollection,
    })));
    // 左栏选中的项（'history' / 'fav:default' / 'fav:<id>' / 'col:<id>'）；默认落在「我的收藏」。
    const [selectedKey, setSelectedKey] = useState<string>(FAVORITES_KEY);
    // 正在「管理」（多选）的项；只有与 selectedKey 一致时右栏才进管理态，切换选中即自动退出。
    const [managingKey, setManagingKey] = useState<string | null>(null);
    // 正在更新快照的收藏歌单 id（拉取期间禁用按钮）。
    const [refreshingId, setRefreshingId] = useState<string | null>(null);
    // 待确认删除的收藏歌单 / 自建列表（都走应用内弹窗，不用系统 confirm）。
    const [pendingDelete, setPendingDelete] = useState<LuoxueSavedCollection | null>(null);
    const [pendingDeleteList, setPendingDeleteList] = useState<LuoxueUserList | null>(null);
    // 正在重命名的列表与草稿名。
    const [renameTarget, setRenameTarget] = useState<LuoxueUserList | null>(null);
    const [renameName, setRenameName] = useState('');
    // 左栏「收藏」分组里的新建列表：行内输入。
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');

    /** 重新拉取上游歌单并覆盖本地快照（「想更新就重新收藏」的落点）。 */
    const handleRefreshCollection = async (item: LuoxueSavedCollection): Promise<void> => {
        if (refreshingId) return;
        setRefreshingId(item.id);
        try {
            const songs = await loadLuoxueCollectionSnapshot({
                kind: item.kind,
                id: item.collectionId,
                lxSource: item.lxSource,
                name: item.name,
                coverUrl: item.coverUrl,
                publisher: item.publisher,
            });
            if (songs.length === 0) {
                setStatusMessage({ type: 'error', text: '没有取到这个歌单的歌曲，已保留原收藏', nonce: Date.now() });
                return;
            }
            const result = saveCollection({
                collectionId: item.collectionId,
                lxSource: item.lxSource,
                kind: item.kind,
                name: item.name,
                coverUrl: item.coverUrl,
                publisher: item.publisher,
            }, songs);
            setStatusMessage({ type: 'success', text: `已更新「${item.name}」（${result.total} 首）`, nonce: Date.now() });
        } catch {
            setStatusMessage({ type: 'error', text: '更新收藏失败，请稍后重试', nonce: Date.now() });
        } finally {
            setRefreshingId(null);
        }
    };

    /** 新建列表：建好后直接选中它，用户往里收歌。 */
    const handleCreateList = (): void => {
        const id = createList(newName);
        setNewName('');
        setCreating(false);
        setSelectedKey(`fav:${id}`);
    };

    const handleDeleteCollection = (item: LuoxueSavedCollection): void => {
        removeCollection(item.id);
        if (selectedKey === `col:${item.id}`) setSelectedKey(FAVORITES_KEY);
        setPendingDelete(null);
    };

    const handleDeleteList = (list: LuoxueUserList): void => {
        removeList(list.id);
        if (selectedKey === `fav:${list.id}`) setSelectedKey(FAVORITES_KEY);
        setPendingDeleteList(null);
    };

    const handleRenameList = (): void => {
        if (!renameTarget) return;
        renameList(renameTarget.id, renameName);
        setRenameTarget(null);
        setRenameName('');
    };

    const renderActionButton = (
        label: string,
        onClick: () => void,
        options?: { primary?: boolean; danger?: boolean; icon?: React.ReactNode; active?: boolean },
    ) => (
        <button
            type="button"
            disabled={!isInteractive}
            onClick={onClick}
            className={headerButtonClass}
            style={options?.primary
                ? { backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }
                : { color: options?.danger || options?.active ? 'var(--text-accent, var(--text-primary))' : 'var(--text-secondary)' }}
        >
            <span className="flex items-center gap-1">{options?.icon}{label}</span>
        </button>
    );

    /** 左栏的一个可选中叶子项：名称 + 数量。 */
    const renderSidebarItem = (key: string, label: string, count: number, countUnit?: string) => {
        const active = selectedKey === key;
        return (
            <button
                key={key}
                type="button"
                disabled={!isInteractive}
                onClick={() => setSelectedKey(key)}
                className={sidebarItemClass(active)}
                style={{ color: active ? 'var(--text-accent, var(--text-primary))' : 'var(--text-primary)' }}
            >
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="shrink-0 text-xs opacity-70">{count}{countUnit ?? ' 首'}</span>
            </button>
        );
    };

    /**
     * 左栏分组标题（不可选中）：与子项共用同一套排版（同字号 / 同内边距 / 同圆角 / 同边框宽度），
     * 只靠淡底色 + 中等字重区分「这是上级」，这样两级在同一个视觉节奏里，又不至于像选中项。
     */
    const renderGroupHeader = (label: string, count: string, actions?: React.ReactNode) => (
        <div
            className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-transparent bg-current/[0.06] px-3 py-2 text-sm font-medium"
            style={{ color: 'var(--text-secondary)' }}
        >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="shrink-0 text-xs opacity-70">{count}</span>
            {actions}
        </div>
    );

    /** 右栏的曲目体：头部动作 + 可选中的列表（管理态由 managingKey 决定）。 */
    const renderDetail = (
        key: string,
        songs: SongResult[],
        emptyText: string,
        removeTitle: string,
        removeDescription: (count: number) => string,
        options?: { onClear?: () => void; onRemoveSelected?: (keys: string[]) => void; subtitle?: string; extraActions?: React.ReactNode },
    ) => {
        const managing = managingKey === key;
        return (
            <div className="flex h-full min-h-0 flex-col gap-3">
                {options?.subtitle ? (
                    <div className="shrink-0 text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>{options.subtitle}</div>
                ) : null}
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {songs.length > 0 ? renderActionButton('播放全部', () => onPlayAll(songs), { primary: true }) : null}
                    {songs.length > 0 && options?.onRemoveSelected
                        ? renderActionButton(managing ? '完成管理' : '管理', () => setManagingKey(managing ? null : key), { icon: <ListChecks size={13} />, active: managing })
                        : null}
                    {songs.length > 0 && options?.onClear ? renderActionButton('清空', options.onClear) : null}
                    {options?.extraActions}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    <LuoxueSelectableSongList
                        key={key}
                        songs={songs}
                        isInteractive={isInteractive}
                        onPlay={index => onPlaySong(songs[index], songs)}
                        onEnqueue={onAddSongToQueue}
                        selecting={managing}
                        onSelectingChange={next => setManagingKey(next ? key : null)}
                        {...(options?.onRemoveSelected ? { onRemoveSelected: options.onRemoveSelected } : {})}
                        emptyText={emptyText}
                        bodyClassName="max-h-none"
                        removeTitle={removeTitle}
                        removeDescription={removeDescription}
                    />
                </div>
            </div>
        );
    };

    const selectedList = selectedKey.startsWith('fav:') && selectedKey !== FAVORITES_KEY
        ? lists.find(item => `fav:${item.id}` === selectedKey)
        : undefined;
    const selectedCollection = selectedKey.startsWith('col:')
        ? collections.find(item => `col:${item.id}` === selectedKey)
        : undefined;

    /** 右栏：按 selectedKey 渲染不同项的曲目与动作。 */
    const renderRightPane = (): React.ReactNode => {
        if (selectedKey === HISTORY_KEY) {
            return renderDetail(
                HISTORY_KEY,
                history,
                '还没有播放记录',
                '删除播放历史中的歌曲',
                count => `确定从「播放历史」里删除选中的 ${count} 首歌曲？`,
                { onClear: clearHistory, onRemoveSelected: removeHistorySongs },
            );
        }
        if (selectedKey === FAVORITES_KEY) {
            return renderDetail(
                FAVORITES_KEY,
                favorites,
                '还没有收藏任何歌曲',
                '删除「我的收藏」中的歌曲',
                count => `确定从「我的收藏」里删除选中的 ${count} 首歌曲？`,
                { onClear: clearFavorites, onRemoveSelected: removeFavoriteSongs },
            );
        }
        if (selectedList) {
            const item = selectedList;
            return renderDetail(
                `fav:${item.id}`,
                item.songs,
                '这个列表还没有歌曲',
                `删除「${item.name}」中的歌曲`,
                count => `确定从「${item.name}」里删除选中的 ${count} 首歌曲？`,
                {
                    onRemoveSelected: keys => removeUserListSongs(item.id, keys),
                    extraActions: (
                        <>
                            {renderActionButton('重命名', () => { setRenameTarget(item); setRenameName(item.name); }, { icon: <Pencil size={13} /> })}
                            {renderActionButton('删除列表', () => setPendingDeleteList(item), { danger: true })}
                        </>
                    ),
                },
            );
        }
        if (selectedCollection) {
            const item = selectedCollection;
            const subtitle = [
                item.publisher,
                item.savedAt ? `收藏于 ${formatSavedTime(item.savedAt)}` : '',
                item.updatedAt && item.updatedAt !== item.savedAt ? `更新于 ${formatSavedTime(item.updatedAt)}` : '',
            ].filter(Boolean).join(' · ');
            return renderDetail(
                `col:${item.id}`,
                item.songs,
                '这个收藏的歌单没有歌曲',
                `删除「${item.name}」中的歌曲`,
                count => `确定从收藏的歌单「${item.name}」里删除选中的 ${count} 首歌曲？只会改本地快照。`,
                {
                    subtitle,
                    onRemoveSelected: keys => removeCollectionSongs(item.id, keys),
                    extraActions: (
                        <>
                            {renderActionButton('更新', () => void handleRefreshCollection(item), {
                                icon: <RefreshCw size={13} className={refreshingId === item.id ? 'animate-spin' : ''} />,
                            })}
                            {renderActionButton('删除歌单', () => setPendingDelete(item), { danger: true })}
                        </>
                    ),
                },
            );
        }
        return null;
    };

    const favoritesTotal = favorites.length + lists.reduce((sum, list) => sum + list.songs.length, 0);

    return (
        <div className="h-full w-full" style={{ color: 'var(--text-primary)' }}>
            <LuoxueSplitBrowser
                emptyText="左侧选一项查看曲目"
                sidebar={(
                    <div className="flex flex-col gap-1">
                        {renderSidebarItem(HISTORY_KEY, '播放历史', history.length)}

                        {renderGroupHeader('收藏', `${favoritesTotal} 首`, (
                            <button
                                type="button"
                                disabled={!isInteractive}
                                onClick={() => setCreating(true)}
                                title="新建列表"
                                aria-label="新建列表"
                                className="rounded-full p-1 transition-colors enabled:hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Plus size={14} />
                            </button>
                        ))}
                        <div className="ml-2 flex flex-col gap-1 border-l border-current/15 pl-3">
                            {renderSidebarItem(FAVORITES_KEY, '我的收藏', favorites.length)}
                            {lists.map(item => renderSidebarItem(`fav:${item.id}`, item.name, item.songs.length))}
                            {creating ? (
                                <div className="flex items-center gap-1.5 rounded-xl border border-current/15 px-2 py-1.5">
                                    <input
                                        autoFocus
                                        value={newName}
                                        onChange={event => setNewName(event.target.value)}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter') handleCreateList();
                                            if (event.key === 'Escape') { setCreating(false); setNewName(''); }
                                        }}
                                        placeholder="新列表名称"
                                        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                                        style={{ color: 'var(--text-primary)' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleCreateList}
                                        className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium transition-opacity hover:opacity-90"
                                        style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                                    >
                                        新建
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setCreating(false); setNewName(''); }}
                                        className="shrink-0 rounded-full px-1.5 py-0.5 text-xs opacity-60 transition-colors hover:opacity-100"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        取消
                                    </button>
                                </div>
                            ) : null}
                        </div>

                        {renderGroupHeader('收藏的歌单', `${collections.length} 张`)}
                        <div className="ml-2 flex flex-col gap-1 border-l border-current/15 pl-3">
                            {collections.length === 0 ? (
                                <div className="px-3 py-1 text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    还没有收藏歌单，去歌单详情点「收藏歌单」
                                </div>
                            ) : (
                                collections.map(item => renderSidebarItem(`col:${item.id}`, item.name, item.songs.length))
                            )}
                        </div>
                    </div>
                )}
                detail={renderRightPane()}
            />

            {pendingDelete ? (
                <ThemedDialog
                    isOpen
                    isDaylight={isDaylight}
                    onClose={() => setPendingDelete(null)}
                    title="删除收藏的歌单"
                    description={`确定不再收藏歌单「${pendingDelete.name}」？只会删掉这份本地快照，不影响上游歌单。`}
                    footer={(
                        <>
                            <button
                                type="button"
                                onClick={() => setPendingDelete(null)}
                                className={`rounded-full px-4 py-2 text-sm transition-colors ${isDaylight ? 'hover:bg-black/[0.06]' : 'hover:bg-white/[0.08]'}`}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDeleteCollection(pendingDelete)}
                                className="flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                                style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                            >
                                <Trash size={14} />
                                删除
                            </button>
                        </>
                    )}
                >
                    <></>
                </ThemedDialog>
            ) : null}

            {pendingDeleteList ? (
                <ThemedDialog
                    isOpen
                    isDaylight={isDaylight}
                    onClose={() => setPendingDeleteList(null)}
                    title="删除列表"
                    description={`确定删除列表「${pendingDeleteList.name}」及其中的 ${pendingDeleteList.songs.length} 首歌曲？`}
                    footer={(
                        <>
                            <button
                                type="button"
                                onClick={() => setPendingDeleteList(null)}
                                className={`rounded-full px-4 py-2 text-sm transition-colors ${isDaylight ? 'hover:bg-black/[0.06]' : 'hover:bg-white/[0.08]'}`}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDeleteList(pendingDeleteList)}
                                className="flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                                style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                            >
                                <Trash size={14} />
                                删除
                            </button>
                        </>
                    )}
                >
                    <></>
                </ThemedDialog>
            ) : null}

            {renameTarget ? (
                <ThemedDialog
                    isOpen
                    isDaylight={isDaylight}
                    onClose={() => setRenameTarget(null)}
                    title="重命名列表"
                    footer={(
                        <>
                            <button
                                type="button"
                                onClick={() => setRenameTarget(null)}
                                className={`rounded-full px-4 py-2 text-sm transition-colors ${isDaylight ? 'hover:bg-black/[0.06]' : 'hover:bg-white/[0.08]'}`}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                disabled={!renameName.trim()}
                                onClick={handleRenameList}
                                className="rounded-full px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                                style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                            >
                                确定
                            </button>
                        </>
                    )}
                >
                    <input
                        autoFocus
                        value={renameName}
                        onChange={event => setRenameName(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') handleRenameList(); }}
                        placeholder="列表名称"
                        className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${isDaylight ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-white/[0.05]'}`}
                        style={{ color: 'var(--text-primary)' }}
                    />
                </ThemedDialog>
            ) : null}
        </div>
    );
};

export default LuoxueMyListPanel;
