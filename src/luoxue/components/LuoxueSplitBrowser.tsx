import React from 'react';

// src/luoxue/components/LuoxueSplitBrowser.tsx
// 洛雪式左右分栏骨架：左 = 选项列表（固定宽度、自己滚动），右 = 选中项的详情（占满剩余空间）。
// 「我的列表」「排行榜」两块面板共用它，层级一眼可见，同级项也不会被展开的兄弟项挤走。
// 自身不加 padding / margin，直接嵌进 LuoxueSection 的「absolute inset-0 flex flex-col p-4」容器。

export type LuoxueSplitBrowserProps = {
    /** 左栏内容（选项列表）；需要自己管选中态与滚动。 */
    sidebar: React.ReactNode;
    /** 右栏内容（选中项详情）。 */
    detail: React.ReactNode;
    /** 右栏为空时的占位文案（如「左侧选一项查看曲目」）。 */
    emptyText?: string;
};

const LuoxueSplitBrowser: React.FC<LuoxueSplitBrowserProps> = ({ sidebar, detail, emptyText = '左侧选一项查看曲目' }) => (
    <div className="flex h-full w-full min-h-0 min-w-0 gap-4">
        <div className="w-[38%] min-w-[200px] max-w-[320px] shrink-0 overflow-y-auto pr-1">
            {sidebar}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
            {detail || (
                <div className="flex h-full items-center justify-center text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {emptyText}
                </div>
            )}
        </div>
    </div>
);

export default LuoxueSplitBrowser;
