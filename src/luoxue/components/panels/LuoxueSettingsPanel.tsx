import React, { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { LxQuality } from '../../sdk';
import {
    LUOXUE_FILE_NAME_TEMPLATES,
    LUOXUE_PLAY_QUALITY_OPTIONS,
    LUOXUE_QUALITY_LABELS,
    selectLuoxueSettings,
    useLuoxueSettingsStore,
    type LuoxueFileNameTemplate,
} from '../../settings/useLuoxueSettingsStore';

// src/luoxue/components/panels/LuoxueSettingsPanel.tsx
// 洛雪的设置面板：播放音质 / 下载目录 / 其它下载项，以及「选择目录」的结果提示。
// 设置读写洛雪自己的 settings store（与 folia 全局设置互不影响）；目录选择与落盘都经主进程，非 Electron 环境只给提示。
// 下载音质不在这里设：各音源对各平台支持的档位不一样，改成点「下载」时在弹窗里按当前音源声明当场选（见 LuoxueDownloadDialog）。
// 下载任务列表也不在这里：移到洛雪自己的「下载」面板（见 LuoxueDownloadPanel）。

type LuoxueSettingsPanelProps = {
    isInteractive: boolean;
};

/** 文件名模板的中文说明（与 store 里的模板一一对应）。 */
const FILE_NAME_LABELS: Record<LuoxueFileNameTemplate, string> = {
    '歌名 - 歌手': '歌曲名 - 艺术家',
    '歌手 - 歌名': '艺术家 - 歌曲名',
    '歌名': '歌曲名',
};

/** 主进程目录选择桥；非 Electron 环境没有这个键。 */
type DirectoryBridge = {
    selectDirectory(): Promise<string | null>;
};

const getDirectoryBridge = (): DirectoryBridge | null => {
    if (typeof window === 'undefined') return null;
    const electron = (window as unknown as { electron?: { luoxueSource?: Partial<DirectoryBridge> } }).electron;
    const bridge = electron?.luoxueSource;
    return bridge && typeof bridge.selectDirectory === 'function' ? (bridge as DirectoryBridge) : null;
};

const qualityPillClass = (active: boolean, disabled: boolean): string =>
    `rounded-full px-3 py-1 text-xs transition-colors ${disabled ? 'cursor-not-allowed opacity-40' : ''} ${active ? '' : 'opacity-60 enabled:hover:opacity-100'}`;

const Toggle: React.FC<{
    label: string;
    hint?: string;
    checked: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => void;
}> = ({ label, hint, checked, disabled, onChange }) => (
    <label className={`flex items-start gap-2 text-sm ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`} style={{ color: 'var(--text-primary)' }}>
        <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={event => onChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-current disabled:cursor-not-allowed"
        />
        <span className="min-w-0">
            <span>{label}</span>
            {hint ? <span className="mt-0.5 block text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>{hint}</span> : null}
        </span>
    </label>
);

const LuoxueSettingsPanel: React.FC<LuoxueSettingsPanelProps> = ({ isInteractive }) => {
    const settings = useLuoxueSettingsStore(useShallow(selectLuoxueSettings));
    const setPlayQuality = useLuoxueSettingsStore(state => state.setPlayQuality);
    const setDownloadDir = useLuoxueSettingsStore(state => state.setDownloadDir);
    const setDownloadEnabled = useLuoxueSettingsStore(state => state.setDownloadEnabled);
    const setSkipExistFile = useLuoxueSettingsStore(state => state.setSkipExistFile);
    const setMaxDownloadNum = useLuoxueSettingsStore(state => state.setMaxDownloadNum);
    const setFileNameFormat = useLuoxueSettingsStore(state => state.setFileNameFormat);
    const setIsEmbedPic = useLuoxueSettingsStore(state => state.setIsEmbedPic);
    const setIsEmbedLyric = useLuoxueSettingsStore(state => state.setIsEmbedLyric);
    const setIsEmbedLyricLx = useLuoxueSettingsStore(state => state.setIsEmbedLyricLx);
    const setIsEmbedLyricT = useLuoxueSettingsStore(state => state.setIsEmbedLyricT);
    const setIsEmbedLyricR = useLuoxueSettingsStore(state => state.setIsEmbedLyricR);
    const setQuotaSaver = useLuoxueSettingsStore(state => state.setQuotaSaver);

    const [message, setMessage] = useState<string | null>(null);
    const disabled = !isInteractive;

    const handleSelectDirectory = async () => {
        if (disabled) return;
        const bridge = getDirectoryBridge();
        if (!bridge) {
            setMessage('选择下载目录仅支持 Electron 桌面端');
            return;
        }
        try {
            const dir = await bridge.selectDirectory();
            if (dir) {
                setDownloadDir(dir);
                setMessage(`下载目录已设为：${dir}`);
            }
        } catch (error) {
            setMessage(`选择目录失败：${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const sectionTitle = (text: string) => (
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{text}</div>
    );

    const renderQualityPills = (options: readonly LxQuality[], current: LxQuality, onPick: (quality: LxQuality) => void) => (
        <div className="flex flex-wrap gap-2">
            {options.map(quality => {
                const active = quality === current;
                return (
                    <button
                        key={quality}
                        type="button"
                        disabled={disabled}
                        onClick={() => onPick(quality)}
                        className={qualityPillClass(active, disabled)}
                        style={active
                            ? { backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }
                            : { color: 'var(--text-secondary)' }}
                    >
                        {LUOXUE_QUALITY_LABELS[quality] ?? quality}
                    </button>
                );
            })}
        </div>
    );

    return (
        <div className="flex h-full w-full flex-col gap-6 overflow-y-auto pr-1">
            <section className="flex flex-col gap-3">
                {sectionTitle('播放音质')}
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>洛雪的播放音质优先于 folia 全局音质偏好；脚本不支持时自动降级。</div>
                {renderQualityPills(LUOXUE_PLAY_QUALITY_OPTIONS, settings.playQuality, setPlayQuality)}
            </section>

            <section className="flex flex-col gap-3">
                {sectionTitle('额度保护')}
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    自定义音源脚本大多按次计费（例如每日 300 次）。同一首歌的播放地址会缓存 1 小时，期间重播、
                    下载都复用这一条，不再重复扣点。
                </div>
                <Toggle
                    label="省点模式（推荐）"
                    hint="不提前为队列里前后几首歌取播放地址，只有真正播到时才取一次；关掉后切歌更顺滑，但每一首邻近的歌都会各自扣一次额度。"
                    checked={settings.quotaSaver}
                    disabled={disabled}
                    onChange={setQuotaSaver}
                />
            </section>

            <section className="flex flex-col gap-3">
                {sectionTitle('下载目录')}
                <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate rounded-xl border border-current/10 px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {settings.downloadDir || '尚未选择下载目录'}
                    </span>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void handleSelectDirectory()}
                        className="inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                    >
                        <FolderOpen size={15} />
                        选择目录
                    </button>
                </div>
            </section>

            <section className="flex flex-col gap-3">
                {sectionTitle('下载')}
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    下载音质在点「下载」时弹窗选择：选项由当前音源脚本对该平台声明的档位决定，各平台支持范围不同。
                </div>
                <Toggle label="启用下载功能" checked={settings.downloadEnabled} disabled={disabled} onChange={setDownloadEnabled} />
                <Toggle
                    label="下载目录存在同名文件时跳过该任务"
                    checked={settings.skipExistFile}
                    disabled={disabled || !settings.downloadEnabled}
                    onChange={setSkipExistFile}
                />
                <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>同时下载任务数</span>
                    <input
                        type="number"
                        min={1}
                        max={6}
                        value={settings.maxDownloadNum}
                        disabled={disabled || !settings.downloadEnabled}
                        onChange={event => setMaxDownloadNum(Number(event.target.value) || 1)}
                        className="w-16 rounded-lg border border-white/10 bg-black/5 px-2 py-1 text-sm focus:outline-none focus:border-white/20 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/5"
                        style={{ color: 'var(--text-primary)' }}
                    />
                    <span className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>过大可能导致 IP 被自定义源封禁</span>
                </div>
                <div className="flex flex-col gap-2">
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>文件命名方式</span>
                    <div className="flex flex-wrap gap-2">
                        {LUOXUE_FILE_NAME_TEMPLATES.map(template => {
                            const active = template === settings.fileNameFormat;
                            return (
                                <button
                                    key={template}
                                    type="button"
                                    disabled={disabled || !settings.downloadEnabled}
                                    onClick={() => setFileNameFormat(template)}
                                    className={qualityPillClass(active, disabled || !settings.downloadEnabled)}
                                    style={active
                                        ? { backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }
                                        : { color: 'var(--text-secondary)' }}
                                >
                                    {FILE_NAME_LABELS[template]}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="flex flex-col gap-3">
                {sectionTitle('嵌入到音频文件中的内容')}
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>下载完成后写入音频文件标签；不支持的文件格式只给出说明，不影响已完成的下载。</div>
                <Toggle
                    label="嵌入封面"
                    checked={settings.isEmbedPic}
                    disabled={disabled || !settings.downloadEnabled}
                    onChange={setIsEmbedPic}
                />
                <Toggle
                    label="嵌入歌词"
                    checked={settings.isEmbedLyric}
                    disabled={disabled || !settings.downloadEnabled}
                    onChange={setIsEmbedLyric}
                />
                <Toggle
                    label="同时嵌入翻译歌词（如果有）"
                    checked={settings.isEmbedLyricT}
                    disabled={disabled || !settings.downloadEnabled || !settings.isEmbedLyric}
                    onChange={setIsEmbedLyricT}
                />
                <Toggle
                    label="同时嵌入罗马音歌词（如果有）"
                    checked={settings.isEmbedLyricR}
                    disabled={disabled || !settings.downloadEnabled || !settings.isEmbedLyric}
                    onChange={setIsEmbedLyricR}
                />
                <Toggle
                    label="同时嵌入 LX Music 歌词（如果有，使用 LX Music 播放时可支持逐字歌词）"
                    checked={settings.isEmbedLyricLx}
                    disabled={disabled || !settings.downloadEnabled || !settings.isEmbedLyric}
                    onChange={setIsEmbedLyricLx}
                />
            </section>

            {message ? (
                <div className="min-w-0 break-words rounded-xl border border-current/10 px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {message}
                </div>
            ) : null}

            <div className="rounded-xl border border-current/10 bg-current/5 px-3 py-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                下载任务在「下载」面板查看（进度 / 重试 / 打开文件位置）。下载需先在「音源」面板导入自定义音源脚本并设为当前音源；歌曲地址与他项能力均由脚本提供。
            </div>
        </div>
    );
};

export default LuoxueSettingsPanel;
