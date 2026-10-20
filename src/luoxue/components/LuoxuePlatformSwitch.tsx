import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BROWSE_PLATFORMS } from '../provider/activeSource';
import { useLuoxueSectionStore } from '../store/useLuoxueSectionStore';
import { luoxueSourceLabel } from './LuoxueSongList';

// src/luoxue/components/LuoxuePlatformSwitch.tsx
// 「浏览平台」切换条：搜索 / 排行榜 / 歌单这类目录能力都按当前浏览平台走，与「当前音源脚本」（取播放地址用）是两件事。
// 点非当前平台即切换，store 会把已加载的目录数据清回 idle，外层按 idle 懒加载的 effect 会重新拉当前面板的数据。

type LuoxuePlatformSwitchProps = {
    isInteractive: boolean;
};

const LuoxuePlatformSwitch: React.FC<LuoxuePlatformSwitchProps> = ({ isInteractive }) => {
    const { browsePlatform, setBrowsePlatform } = useLuoxueSectionStore(useShallow(state => ({
        browsePlatform: state.browsePlatform,
        setBrowsePlatform: state.setBrowsePlatform,
    })));

    return (
        <div className="flex shrink-0 flex-wrap items-center gap-2" role="group" aria-label="浏览平台">
            <span className="shrink-0 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>浏览平台</span>
            <div className="flex flex-wrap gap-1.5">
                {BROWSE_PLATFORMS.map(id => {
                    const active = id === browsePlatform;
                    return (
                        <button
                            key={id}
                            type="button"
                            disabled={!isInteractive}
                            onClick={() => {
                                if (!active) setBrowsePlatform(id);
                            }}
                            className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed ${active ? 'border-current/30 opacity-100' : 'border-current/10 opacity-70 enabled:hover:bg-current/10 enabled:hover:opacity-100'}`}
                            style={{ color: active ? 'var(--text-accent, var(--text-primary))' : 'var(--text-secondary)' }}
                        >
                            {luoxueSourceLabel(id)}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default LuoxuePlatformSwitch;
