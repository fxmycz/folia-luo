import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ExternalLink, FolderOpen, Link2, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import { useLxSourceStore } from '../../services/lxSource/lxSourceStore';
import type { LxSourceApiInfo } from '../../services/lxSource/lxSourceTransport';
import { getReadableTextColor } from '../../utils/themeColorMath';

// src/components/lxSource/LxSourceManager.tsx
// 自定义音源版块的管理面板：在线链接导入 / 本地文件导入、列表、启用停用、删除、状态与更新提示。
// 数据全部经 useLxSourceStore（→ lxSourceTransport → 主进程 IPC）。

type Props = {
    isDaylight: boolean;
    accentColor: string;
};

const PANEL = 'rounded-2xl border backdrop-blur-sm';
const panelTone = (isDaylight: boolean) => (isDaylight
    ? 'border-black/5 bg-white/70'
    : 'border-white/10 bg-white/5');

const statusTone = (isDaylight: boolean, active: boolean) => (active
    ? (isDaylight ? 'bg-emerald-500/10 text-emerald-600' : 'bg-emerald-400/15 text-emerald-300')
    : (isDaylight ? 'bg-black/5 text-zinc-500' : 'bg-white/10 text-white/60'));

const SourceCard: React.FC<{
    api: LxSourceApiInfo;
    isActive: boolean;
    isDaylight: boolean;
    accentColor: string;
    onActivate: () => void;
    onRemove: () => void;
}> = ({ api, isActive, isDaylight, accentColor, onActivate, onRemove }) => {
    const { t } = useTranslation();
    return (
        <div className={`${PANEL} ${panelTone(isDaylight)} p-4`}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={`truncate text-sm font-semibold ${isDaylight ? 'text-zinc-900' : 'text-white'}`}>
                            {api.name || t('lxSource.title')}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${statusTone(isDaylight, isActive)}`}>
                            {isActive ? t('lxSource.active') : t('lxSource.inactive')}
                        </span>
                    </div>
                    {api.description && (
                        <p className={`mt-1 line-clamp-2 text-xs ${isDaylight ? 'text-zinc-500' : 'text-white/50'}`}>
                            {api.description}
                        </p>
                    )}
                    <p className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] ${isDaylight ? 'text-zinc-400' : 'text-white/40'}`}>
                        {api.version && <span>{t('lxSource.version')} {api.version}</span>}
                        {api.author && <span>{t('lxSource.author')} {api.author}</span>}
                        {api.homepage && (
                            <a href={api.homepage} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 hover:underline">
                                {t('lxSource.homepage')}<ExternalLink size={11} />
                            </a>
                        )}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={onActivate}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium transition-transform hover:scale-[1.03]"
                        style={isActive
                            ? { backgroundColor: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.12)',
                                color: isDaylight ? '#3f3f46' : 'rgba(255,255,255,0.85)' }
                            : { backgroundColor: accentColor, color: getReadableTextColor(accentColor) }}
                    >
                        {isActive ? t('lxSource.deactivate') : t('lxSource.activate')}
                    </button>
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label={t('lxSource.remove')}
                        className={`rounded-lg p-2 transition-colors ${isDaylight
                            ? 'text-zinc-400 hover:bg-black/5 hover:text-rose-500'
                            : 'text-white/40 hover:bg-white/10 hover:text-rose-300'}`}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export const LxSourceManager: React.FC<Props> = ({ isDaylight, accentColor }) => {
    const { t } = useTranslation();
    const apis = useLxSourceStore(state => state.apis);
    const activeApiId = useLxSourceStore(state => state.activeApiId);
    const status = useLxSourceStore(state => state.status);
    const isLoading = useLxSourceStore(state => state.isLoading);
    const error = useLxSourceStore(state => state.error);
    const updateAlert = useLxSourceStore(state => state.updateAlert);
    const refresh = useLxSourceStore(state => state.refresh);
    const importFromUrl = useLxSourceStore(state => state.importFromUrl);
    const importFromFile = useLxSourceStore(state => state.importFromFile);
    const remove = useLxSourceStore(state => state.remove);
    const setActive = useLxSourceStore(state => state.setActive);
    const openDevTools = useLxSourceStore(state => state.openDevTools);
    const dismissUpdateAlert = useLxSourceStore(state => state.dismissUpdateAlert);

    const [url, setUrl] = useState('');

    useEffect(() => { void refresh(); }, [refresh]);

    const handleImportUrl = async () => {
        if (!url.trim()) return;
        if (await importFromUrl(url.trim())) setUrl('');
    };

    const handleImportFile = async () => {
        await importFromFile();
    };

    const handleRemove = async (id: string) => {
        if (!window.confirm(t('lxSource.removeConfirm'))) return;
        await remove([id]);
    };

    const statusLabel = !status?.activeApiId
        ? t('lxSource.statusUnloaded')
        : status.loaded
            ? t('lxSource.statusLoaded')
            : status.message || t('lxSource.statusFailed');

    const inputClass = `flex-1 rounded-xl border px-3 py-2 text-sm outline-none transition-colors ${isDaylight
        ? 'border-black/10 bg-white/80 text-zinc-800 placeholder:text-zinc-400 focus:border-black/25'
        : 'border-white/10 bg-black/20 text-white placeholder:text-white/30 focus:border-white/25'}`;

    const activeStatus = status?.sources ?? {};

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 pb-16">
            {updateAlert && (
                <div className={`${PANEL} ${panelTone(isDaylight)} flex items-center justify-between gap-4 p-3`}>
                    <span className={`text-xs ${isDaylight ? 'text-amber-700' : 'text-amber-300'}`}>
                        {t('lxSource.updateAvailable', { log: updateAlert.log })}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                        {updateAlert.updateUrl && (
                            <a href={updateAlert.updateUrl} target="_blank" rel="noreferrer"
                                className="rounded-lg px-3 py-1 text-xs font-medium"
                                style={{ backgroundColor: accentColor, color: getReadableTextColor(accentColor) }}>
                                {t('lxSource.openUpdate')}
                            </a>
                        )}
                        <button type="button" onClick={dismissUpdateAlert}
                            className={`text-xs ${isDaylight ? 'text-zinc-400' : 'text-white/40'}`}>
                            ✕
                        </button>
                    </div>
                </div>
            )}

            {/* 导入 */}
            <section className={`${PANEL} ${panelTone(isDaylight)} p-4`}>
                <div className="flex items-center gap-2">
                    <Link2 size={15} className={isDaylight ? 'text-zinc-400' : 'text-white/40'} />
                    <input
                        value={url}
                        onChange={event => setUrl(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') void handleImportUrl(); }}
                        placeholder={t('lxSource.importUrlPlaceholder')}
                        className={inputClass}
                    />
                    <button
                        type="button"
                        onClick={handleImportUrl}
                        disabled={isLoading || !url.trim()}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-transform hover:scale-[1.03] disabled:opacity-40"
                        style={{ backgroundColor: accentColor, color: getReadableTextColor(accentColor) }}
                    >
                        <Download size={14} />
                        {isLoading ? t('lxSource.importing') : t('lxSource.import')}
                    </button>
                </div>
                <button
                    type="button"
                    onClick={() => void handleImportFile()}
                    disabled={isLoading}
                    className={`mt-3 flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${isDaylight
                        ? 'border-black/10 bg-white/80 text-zinc-700 hover:bg-white'
                        : 'border-white/15 bg-white/10 text-white/85 hover:bg-white/15'}`}
                >
                    <FolderOpen size={14} />
                    {t('lxSource.importFile')}
                </button>
            </section>

            {/* 状态条 */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className={`text-xs ${isDaylight ? 'text-zinc-500' : 'text-white/50'}`}>
                        {t('lxSource.status')}：{statusLabel}
                    </span>
                    {Object.keys(activeStatus).length > 0 && (
                        <span className={`text-[11px] ${isDaylight ? 'text-zinc-400' : 'text-white/35'}`}>
                            {Object.keys(activeStatus).join(' / ')}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void refresh()}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${isDaylight
                            ? 'text-zinc-500 hover:bg-black/5' : 'text-white/50 hover:bg-white/10'}`}
                    >
                        <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
                        {t('lxSource.refresh')}
                    </button>
                    {activeApiId && (
                        <button
                            type="button"
                            onClick={() => void openDevTools()}
                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${isDaylight
                                ? 'text-zinc-500 hover:bg-black/5' : 'text-white/50 hover:bg-white/10'}`}
                        >
                            <Terminal size={13} />
                            {t('lxSource.openDevTools')}
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <p className={`text-xs ${isDaylight ? 'text-rose-600' : 'text-rose-300'}`}>{error}</p>
            )}

            {/* 列表 */}
            {apis.length === 0 ? (
                <div className={`${PANEL} ${panelTone(isDaylight)} flex flex-col items-center gap-2 px-6 py-12 text-center`}>
                    <p className={`text-sm ${isDaylight ? 'text-zinc-600' : 'text-white/70'}`}>{t('lxSource.empty')}</p>
                    <p className={`text-xs ${isDaylight ? 'text-zinc-400' : 'text-white/40'}`}>{t('lxSource.emptyHint')}</p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {apis.map(api => (
                        <SourceCard
                            key={api.id}
                            api={api}
                            isActive={api.id === activeApiId}
                            isDaylight={isDaylight}
                            accentColor={accentColor}
                            onActivate={() => void setActive(api.id === activeApiId ? null : api.id)}
                            onRemove={() => void handleRemove(api.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
