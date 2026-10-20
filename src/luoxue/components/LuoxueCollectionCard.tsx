import React from 'react';
import { Disc } from 'lucide-react';
import type { ProviderCollection } from '../../types/onlineMusic';

// src/luoxue/components/LuoxueCollectionCard.tsx
// 洛雪歌单卡片：封面占三分之一宽（歌单面板历来如此），右侧是歌单名与「发布者 · N 首」。
// 歌单面板与搜索面板（歌单类别）共用同一张卡片，免得两处各画一套。

const LuoxueCollectionCard: React.FC<{
    collection: ProviderCollection;
    isInteractive: boolean;
    onOpen: () => void;
}> = ({ collection, isInteractive, onOpen }) => {
    const meta = [
        collection.publisher,
        collection.trackCount ? `${collection.trackCount} 首` : null,
    ].filter(Boolean).join(' · ');
    return (
        <button
            type="button"
            disabled={!isInteractive}
            onClick={onOpen}
            className="group flex items-center gap-3 text-left disabled:cursor-not-allowed"
        >
            <div className="relative aspect-square w-1/3 shrink-0 overflow-hidden rounded-xl border border-current/10 bg-current/5">
                {collection.coverUrl ? (
                    <img src={collection.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                    <span className="flex h-full w-full items-center justify-center opacity-30">
                        <Disc size={30} />
                    </span>
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{collection.name}</div>
                {meta ? (
                    <div className="mt-0.5 truncate text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>{meta}</div>
                ) : null}
            </div>
        </button>
    );
};

export default LuoxueCollectionCard;
