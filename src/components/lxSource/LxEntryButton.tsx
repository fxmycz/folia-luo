import React from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';
import { getLxSourceBridge } from '../../services/lxSource/lxSourceTransport';
import { getReadableTextColor } from '../../utils/themeColorMath';

// src/components/lxSource/LxEntryButton.tsx
// 「自定义音源」版块的入口：一枚实底紧凑按钮，贴在窗口标题栏左侧带内（top-0 起 32px 高的可拖拽区）。
//
// 不叠在主界面内容层之上，因此不遮挡 Folia 任何既有组件；实色底纹、无模糊、无半透明，
// 文字颜色按 accent 亮度自适应。没有 electron 桥（Web 端）时直接不渲染。

type Props = {
    accentColor: string;
    onEnter: () => void;
};

export const LxEntryButton: React.FC<Props> = ({ accentColor, onEnter }) => {
    const { t } = useTranslation();
    // 版块仅桌面端可用；Web 端隐藏入口。
    if (!getLxSourceBridge()) return null;

    return (
        <button
            type="button"
            onClick={onEnter}
            title={t('lxSource.entryHint')}
            className="absolute left-2 top-1 z-[10000] flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition-transform duration-150 hover:scale-[1.03] active:scale-100"
            style={{
                backgroundColor: accentColor,
                color: getReadableTextColor(accentColor),
                WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
        >
            <Radio size={13} />
            <span className="leading-none">{t('lxSource.entryLabel')}</span>
        </button>
    );
};
