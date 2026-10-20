import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useLuoxueSectionStore } from '../../store/useLuoxueSectionStore';
import type { LuoxuePlaybackCallbacks } from '../LuoxueSongList';
import LuoxueCollectionCard from '../LuoxueCollectionCard';
import LuoxueCollectionDetail from '../LuoxueCollectionDetail';
import LuoxuePlatformSwitch from '../LuoxuePlatformSwitch';

// src/luoxue/components/panels/LuoxueSongListsPanel.tsx
// 歌单面板：顶部分类是两层——第一行「全部 + 各分组」，点分组展开 / 收起它下面的标签（第二行），
// 点标签才切列表；下面是歌单卡片网格与「加载更多」；点开歌单进入集合详情（共用 LuoxueCollectionDetail）。

type LuoxueSongListsPanelProps = LuoxuePlaybackCallbacks;

/** 分类里的一枚可点标签：选中态用强调色，未选中态压暗。 */
const TagChip: React.FC<{ label: string; active: boolean; disabled: boolean; onClick: () => void }> = ({ label, active, disabled, onClick }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed ${active ? 'border-current/30 opacity-100' : 'border-current/10 opacity-70 hover:opacity-100'}`}
        style={{ color: active ? 'var(--text-accent, var(--text-primary))' : 'var(--text-secondary)' }}
    >
        {label}
    </button>
);

const LuoxueSongListsPanel: React.FC<LuoxueSongListsPanelProps> = ({ isInteractive, onPlaySong, onAddSongToQueue, onPlayAll }) => {
    const {
        songlistTagGroups,
        activeTagId,
        setActiveTagId,
        songlists,
        songlistsStatus,
        songlistsHasMore,
        loadSongLists,
        openCollection,
        openCollectionTracks,
    } = useLuoxueSectionStore(useShallow(state => ({
        songlistTagGroups: state.songlistTagGroups,
        activeTagId: state.activeTagId,
        setActiveTagId: state.setActiveTagId,
        songlists: state.songlists,
        songlistsStatus: state.songlistsStatus,
        songlistsHasMore: state.songlistsHasMore,
        loadSongLists: state.loadSongLists,
        // 详情按面板各记一份：这块读的是歌单面板自己打开的那个（切面板 / 切回来都不串台、也不丢）。
        openCollection: state.openCollections.songlists,
        openCollectionTracks: state.openCollectionTracks,
    })));

    /**
     * 展开着哪个分组。null 表示还没手动点过：自动展开「含当前选中标签的那一组，否则第一组」，
     * 好让人一眼看到组内标签确实存在；'' 表示主动收起。
     * 分组名随音源变化，这里对不存在的老名字直接落回收起态，不会卡住。
     */
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
    const activeGroupName = useMemo(() => {
        if (expandedGroup !== null) return songlistTagGroups.some(group => group.name === expandedGroup) ? expandedGroup : '';
        const containing = songlistTagGroups.find(group => group.tags.some(tag => String(tag.id) === activeTagId));
        return (containing ?? songlistTagGroups[0])?.name ?? '';
    }, [songlistTagGroups, expandedGroup, activeTagId]);
    const activeGroup = songlistTagGroups.find(group => group.name === activeGroupName) ?? null;

    /** 切列表用的是组内标签自己的 id：分组只有名字、没有 id，拿它当筛选值只会把列表按错条件拉一遍。 */
    const selectTag = (tagId: string) => {
        if (tagId === activeTagId) return;
        setActiveTagId(tagId);
        void loadSongLists();
    };

    if (openCollection) {
        return (
            <LuoxueCollectionDetail
                owner="songlists"
                isInteractive={isInteractive}
                onPlaySong={onPlaySong}
                onAddSongToQueue={onAddSongToQueue}
                onPlayAll={onPlayAll}
                emptyText="这个歌单暂时没有歌曲"
                errorText="歌单加载失败，请返回后重试"
            />
        );
    }

    const loading = songlistsStatus === 'loading';

    return (
        <div className="flex h-full w-full flex-col gap-4">
            <LuoxuePlatformSwitch isInteractive={isInteractive} />

            {songlistTagGroups.length > 0 ? (
                <div className="flex shrink-0 flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                        <TagChip
                            label="全部"
                            active={activeTagId === ''}
                            disabled={!isInteractive}
                            onClick={() => {
                                setExpandedGroup('');
                                selectTag('');
                            }}
                        />
                        {songlistTagGroups.map(group => (
                            <TagChip
                                key={group.name}
                                label={group.name}
                                active={group.name === activeGroupName}
                                disabled={!isInteractive}
                                onClick={() => setExpandedGroup(group.name === activeGroupName ? '' : group.name)}
                            />
                        ))}
                    </div>
                    {activeGroup ? (
                        <div className="flex flex-wrap gap-2">
                            {activeGroup.tags.map(tag => (
                                <TagChip
                                    key={String(tag.id)}
                                    label={tag.name}
                                    active={String(tag.id) === activeTagId}
                                    disabled={!isInteractive}
                                    onClick={() => selectTag(String(tag.id))}
                                />
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {songlistsStatus === 'error' ? (
                    <div className="py-10 text-center text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>歌单加载失败，请稍后重试</div>
                ) : loading && songlists.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm opacity-50" style={{ color: 'var(--text-secondary)' }}>
                        <Loader2 size={16} className="animate-spin" />
                        正在加载歌单…
                    </div>
                ) : songlists.length === 0 ? (
                    <div className="py-10 text-center text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>当前分类下没有歌单</div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                            {songlists.map(list => (
                                <LuoxueCollectionCard
                                    key={String(list.id)}
                                    collection={list}
                                    isInteractive={isInteractive}
                                    onOpen={() => void openCollectionTracks('songlists', list)}
                                />
                            ))}
                        </div>
                        {songlistsHasMore ? (
                            <div className="flex justify-center py-4">
                                <button
                                    type="button"
                                    disabled={!isInteractive || loading}
                                    onClick={() => void loadSongLists({ append: true })}
                                    className="rounded-full border border-current/15 px-4 py-1.5 text-sm transition-colors enabled:hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-40"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {loading ? '加载中…' : '加载更多'}
                                </button>
                            </div>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
};

export default LuoxueSongListsPanel;
