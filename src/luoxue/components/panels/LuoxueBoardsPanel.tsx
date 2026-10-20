import React from 'react';
import { Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useLuoxueSectionStore } from '../../store/useLuoxueSectionStore';
import type { LuoxuePlaybackCallbacks } from '../LuoxueSongList';
import LuoxueCollectionDetail from '../LuoxueCollectionDetail';
import LuoxuePlatformSwitch from '../LuoxuePlatformSwitch';
import LuoxueSplitBrowser from '../LuoxueSplitBrowser';

// src/luoxue/components/panels/LuoxueBoardsPanel.tsx
// 排行榜面板：左栏选榜单（可切浏览平台），右栏出该榜单的曲目与动作，不再下钻替换整屏。
// 选中态沿用 store 的 openCollections.boards，切走再切回来仍停在同一个榜单上。
// 不自动选中首个榜单：进面板即拉曲目会额外消耗音源配额，保持按需加载。

type LuoxueBoardsPanelProps = LuoxuePlaybackCallbacks;

const LuoxueBoardsPanel: React.FC<LuoxueBoardsPanelProps> = ({ isInteractive, onPlaySong, onAddSongToQueue, onPlayAll }) => {
    const {
        boards,
        boardsStatus,
        openCollection,
        openCollectionTracks,
    } = useLuoxueSectionStore(useShallow(state => ({
        boards: state.boards,
        boardsStatus: state.boardsStatus,
        // 详情按面板各记一份：这块读的是排行榜自己打开的那个（切面板 / 切回来都不串台、也不丢）。
        openCollection: state.openCollections.boards,
        openCollectionTracks: state.openCollectionTracks,
    })));

    const selectedId = openCollection ? String(openCollection.collection.id) : null;

    return (
        <LuoxueSplitBrowser
            emptyText="左侧选一个榜单查看曲目"
            sidebar={(
                <div className="flex flex-col gap-3">
                    <LuoxuePlatformSwitch isInteractive={isInteractive} />

                    {boardsStatus === 'loading' && boards.length === 0 ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            <Loader2 size={16} className="animate-spin" />
                            正在加载排行榜…
                        </div>
                    ) : boardsStatus === 'error' ? (
                        <div className="py-10 text-center text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>排行榜加载失败，请稍后重试</div>
                    ) : boards.length === 0 ? (
                        <div className="py-10 text-center text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>当前音源没有可用排行榜</div>
                    ) : (
                        <div className="flex flex-col gap-1">
                            {boards.map(board => {
                                const active = selectedId === String(board.id);
                                return (
                                    <button
                                        key={String(board.id)}
                                        type="button"
                                        disabled={!isInteractive}
                                        onClick={() => void openCollectionTracks('boards', board)}
                                        className={`flex w-full min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'border-transparent bg-current/10' : 'border-current/10 enabled:hover:bg-current/5'}`}
                                        style={{ color: active ? 'var(--text-accent, var(--text-primary))' : 'var(--text-primary)' }}
                                    >
                                        <span className="min-w-0 flex-1 truncate font-medium">{board.name}</span>
                                        {board.trackCount ? (
                                            <span className="shrink-0 text-xs opacity-70">{board.trackCount} 首</span>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
            detail={openCollection ? (
                <LuoxueCollectionDetail
                    owner="boards"
                    showBack={false}
                    isInteractive={isInteractive}
                    onPlaySong={onPlaySong}
                    onAddSongToQueue={onAddSongToQueue}
                    onPlayAll={onPlayAll}
                    emptyText="这个榜单暂时没有歌曲"
                    errorText="榜单加载失败，请在左侧重新选一次"
                />
            ) : null}
        />
    );
};

export default LuoxueBoardsPanel;
