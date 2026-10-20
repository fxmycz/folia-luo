import React, { useState } from 'react';
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { SongResult } from '../../types';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { useLuoxueSectionStore, type LuoxueCollectionOwner } from '../store/useLuoxueSectionStore';
import { luoxueCollectionKey, useLuoxueLibraryStore } from '../store/useLuoxueLibraryStore';
import { loadLuoxueCollectionSnapshot, toLuoxueCollectionSource } from '../services/collectionSnapshot';
import LuoxueSongList, { type LuoxuePlaybackCallbacks } from './LuoxueSongList';

// src/luoxue/components/LuoxueCollectionDetail.tsx
// 洛雪集合详情的展示层（排行榜 / 歌单 / 搜索页打开的歌单共用）：
// 返回（可选）+ 标题（可选）+ 收藏歌单 / 更新收藏 + 播放全部 + 曲目列表 + 加载更多。
// 「收藏歌单」把歌单本身存成一份本地快照（不随上游更新，想看最新的就再点一次「更新收藏」）。
// 每块面板各记自己那份「打开着的集合」（store 的 openCollections），所以这里必须带 owner 才知道读哪一份。
// 排行榜面板自带左栏（榜单列表），故传 showBack={false} 只取曲目体与动作，返回与标题交给左栏。

export type LuoxueCollectionTracksProps = LuoxuePlaybackCallbacks & {
    owner: LuoxueCollectionOwner;
    emptyText: string;
    errorText: string;
};

/** 只渲染「打开着的集合」的曲目：加载中 / 列表 / 加载更多（供集合详情与排行榜右栏复用）。 */
export const LuoxueCollectionTracks: React.FC<LuoxueCollectionTracksProps> = ({
    owner,
    emptyText,
    errorText,
    isInteractive,
    onPlaySong,
    onAddSongToQueue,
}) => {
    const { openCollection, loadMoreCollectionTracks } = useLuoxueSectionStore(useShallow(state => ({
        openCollection: state.openCollections[owner],
        loadMoreCollectionTracks: state.loadMoreCollectionTracks,
    })));

    if (!openCollection) return null;

    const { status, tracks, hasMore } = openCollection;
    const songs = tracks as SongResult[];
    const loading = status === 'loading' && songs.length === 0;
    const loadingMore = status === 'loading' && songs.length > 0;

    if (status === 'error') {
        return (
            <div className="py-10 text-center text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
                {errorText}
            </div>
        );
    }

    return (
        <>
            <LuoxueSongList
                songs={songs}
                isInteractive={isInteractive}
                loading={loading}
                emptyText={emptyText}
                onPlay={index => onPlaySong(songs[index], songs)}
                onEnqueue={onAddSongToQueue}
            />
            {hasMore ? (
                <div className="flex justify-center py-4">
                    <button
                        type="button"
                        disabled={!isInteractive || loadingMore}
                        onClick={() => void loadMoreCollectionTracks(owner)}
                        className="rounded-full border border-current/15 px-4 py-1.5 text-sm transition-colors enabled:hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        {loadingMore ? '加载中…' : '加载更多'}
                    </button>
                </div>
            ) : null}
        </>
    );
};

type LuoxueCollectionDetailProps = LuoxuePlaybackCallbacks & {
    owner: LuoxueCollectionOwner;
    emptyText: string;
    errorText: string;
    /** 是否渲染返回按钮与标题；排行榜左栏已列出榜单名，故传 false。默认 true。 */
    showBack?: boolean;
};

const LuoxueCollectionDetail: React.FC<LuoxueCollectionDetailProps> = ({
    owner,
    emptyText,
    errorText,
    showBack = true,
    isInteractive,
    onPlaySong,
    onAddSongToQueue,
    onPlayAll,
}) => {
    const { openCollection, closeCollection } = useLuoxueSectionStore(useShallow(state => ({
        openCollection: state.openCollections[owner],
        closeCollection: state.closeCollection,
    })));
    const { savedCollections, saveCollection } = useLuoxueLibraryStore(useShallow(state => ({
        savedCollections: state.collections,
        saveCollection: state.saveCollection,
    })));
    const [savingCollection, setSavingCollection] = useState(false);

    if (!openCollection) return null;

    const { collection, tracks } = openCollection;
    const songs = tracks as SongResult[];
    const source = toLuoxueCollectionSource(collection);
    // 同一个上游歌单（同音源 + 同类型 + 同 id）已经收藏过时，按钮变成「更新收藏」。
    const saved = source
        ? savedCollections.find(item => luoxueCollectionKey(item) === luoxueCollectionKey(source))
        : undefined;

    /** 收藏 / 更新这个歌单：拉全曲目后存成快照（更新时整体覆盖）。 */
    const handleSaveCollection = async (): Promise<void> => {
        if (!source || savingCollection) return;
        setSavingCollection(true);
        try {
            const snapshot = await loadLuoxueCollectionSnapshot(source);
            if (snapshot.length === 0) {
                setStatusMessage({ type: 'error', text: '这个歌单没有可取到的歌曲', nonce: Date.now() });
                return;
            }
            const result = saveCollection({
                collectionId: source.id,
                lxSource: source.lxSource,
                kind: source.kind,
                name: source.name,
                coverUrl: source.coverUrl,
                publisher: source.publisher,
            }, snapshot);
            setStatusMessage({
                type: 'success',
                text: result.refreshed
                    ? `已更新收藏「${source.name}」（${result.total} 首）`
                    : `已收藏歌单「${source.name}」（${result.total} 首）`,
                nonce: Date.now(),
            });
        } catch {
            setStatusMessage({ type: 'error', text: '收藏歌单失败，请稍后重试', nonce: Date.now() });
        } finally {
            setSavingCollection(false);
        }
    };

    // 返回 / 标题 / 收藏 / 播放全部都没有可显示的内容时，整个头都不渲染（避免空一条）。
    const hasHeader = showBack || Boolean(source) || songs.length > 0;

    return (
        <div className="flex h-full w-full flex-col gap-4">
            {hasHeader ? (
                <div className="flex shrink-0 items-center gap-3">
                    {showBack ? (
                        <>
                            <button
                                type="button"
                                onClick={() => closeCollection(owner)}
                                className="shrink-0 rounded-full border border-current/15 px-3 py-1.5 text-sm transition-colors hover:bg-current/10"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                返回
                            </button>
                            <div className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {collection.name}
                            </div>
                        </>
                    ) : null}
                    {source ? (
                        <button
                            type="button"
                            disabled={!isInteractive || savingCollection}
                            onClick={() => void handleSaveCollection()}
                            title={saved ? '重新拉取这个歌单最新的曲目并覆盖本地收藏' : '把歌单本身收藏到「我的列表」，之后不随上游更新'}
                            className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-current/15 px-3 py-1.5 text-sm transition-colors enabled:hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-40"
                            style={saved ? { color: 'var(--text-accent, var(--text-primary))' } : { color: 'var(--text-primary)' }}
                        >
                            {savingCollection ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : saved ? (
                                <BookmarkCheck size={14} fill="currentColor" />
                            ) : (
                                <Bookmark size={14} />
                            )}
                            {savingCollection ? '正在收藏…' : saved ? '更新收藏' : '收藏歌单'}
                        </button>
                    ) : null}
                    {songs.length > 0 ? (
                        <button
                            type="button"
                            disabled={!isInteractive}
                            onClick={() => onPlayAll(songs)}
                            className={`${source ? '' : 'ml-auto '}shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40`}
                            style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                        >
                            播放全部
                        </button>
                    ) : null}
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <LuoxueCollectionTracks
                    owner={owner}
                    emptyText={emptyText}
                    errorText={errorText}
                    isInteractive={isInteractive}
                    onPlaySong={onPlaySong}
                    onAddSongToQueue={onAddSongToQueue}
                    onPlayAll={onPlayAll}
                />
            </div>
        </div>
    );
};

export default LuoxueCollectionDetail;
