import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import LuoxueSection, { type LuoxueSectionProps } from './LuoxueSection';

// src/luoxue/components/LuoxueBravaisLayer.tsx
// Bravais 首页的「洛雪」层。Bravais 的首页 surface 只渲染一个不可见锚点，墙与缝（页签条、工具格）都在
// stage 的子树里。面板若留在锚点里就落在 stage 之外——z-index 跨不出层叠上下文，面板会压住缝，
// 页签点不到。所以这里用 portal 把面板挂进 stage 根，让缝（.bravais-seam，z-5）与面板同处一个
// 层叠上下文，缝于是自然盖在面板之上；面板自身取 z-1，既在空墙（z-auto）之上，又在缝与 chrome 之下。

type LuoxueBravaisLayerProps = Omit<LuoxueSectionProps, 'variant'>;

/** stage 根可能比首页 surface 晚一帧挂载：找不到就顺着帧重试有限次，失败就整块不渲染。 */
const useBravaisStageRoot = (): HTMLElement | null => {
    const [root, setRoot] = useState<HTMLElement | null>(null);
    useEffect(() => {
        let frameId = 0;
        let attempts = 0;
        const find = () => {
            const element = document.querySelector<HTMLElement>('[data-library-stage="bravais"]');
            if (element) {
                setRoot(element);
                return;
            }
            if (attempts < 60) {
                attempts += 1;
                frameId = window.requestAnimationFrame(find);
            }
        };
        find();
        return () => window.cancelAnimationFrame(frameId);
    }, []);
    return root;
};

const LuoxueBravaisLayer: React.FC<LuoxueBravaisLayerProps> = (props) => {
    const stageRoot = useBravaisStageRoot();
    if (!stageRoot) return null;
    return createPortal(
        <div
            className={`absolute inset-0 z-[1] ${props.isInteractive ? 'pointer-events-auto' : 'pointer-events-none'}`}
            style={{ backgroundColor: 'var(--bg-color)' }}
        >
            <LuoxueSection {...props} variant="bravais" />
        </div>,
        stageRoot,
    );
};

export default LuoxueBravaisLayer;
