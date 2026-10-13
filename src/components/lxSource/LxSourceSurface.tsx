import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Headphones, Heart, Search, Settings, Radio } from 'lucide-react';
import type { SongResult, Theme } from '../../types';
import type { OmniCollection } from '../../types/onlineMusic';
import { getLxSourceBridge } from '../../services/lxSource/lxSourceTransport';
import { useLxDownloadStore } from '../../stores/useLxDownloadStore';
import { useLxAuditionStore } from '../../stores/useLxAuditionStore';
import { useLxBrowseMemoryStore, type LxSurfaceTab } from '../../stores/useLxBrowseMemoryStore';
import { LxSourceManager } from './LxSourceManager';
import { LxBoardBrowser } from './LxBoardBrowser';
import { LxFavoritesPanel } from './LxFavoritesPanel';
import { LxAuditionPanel } from './LxAuditionPanel';
import { LxDownloadPanel } from './LxDownloadPanel';

// src/components/lxSource/LxSourceSurface.tsx
// 「自定义音源（洛雪）」版块的整页外壳（AppView 'lx'）：自包含的一级版块，内部用子标签组织
// 「在线浏览 / 试听 / 收藏 / 音源管理 / 下载」，不依赖 Folia 既有页面结构。桌面端专属：没有 electron 桥（Web 端）时给出说明文案。

// 下载提示条：无论停在哪个标签，入队 / 完成 / 失败都在底部浮出一条，几秒后自动消失。
const DownloadNoticeToast: React.FC<{ isDaylight: boolean }> = ({ isDaylight }) => {
    const { t } = useTranslation();
    const notice = useLxDownloadStore(state => state.notice);
    const dismissNotice = useLxDownloadStore(state => state.dismissNotice);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => dismissNotice(), 4000);
        return () => window.clearTimeout(timer);
    }, [notice, dismissNotice]);

    if (!notice) return null;

    const text = notice.kind === 'queued'
        ? t('lxSource.downloadQueuedNotice', { name: notice.name })
        : notice.kind === 'done'
            ? t('lxSource.downloadDoneNotice', { name: notice.name, quality: notice.quality ?? '' })
            : t('lxSource.downloadFailedNotice', { name: notice.name, error: notice.error ?? '' });

    const tone = notice.kind === 'error'
        ? 'bg-rose-600 text-white'
        : notice.kind === 'done'
            ? 'bg-emerald-600 text-white'
            : (isDaylight ? 'bg-zinc-800 text-white' : 'bg-white text-zinc-900');

    return (
        <div className={`fixed bottom-6 left-1/2 z-[10001] max-w-[80vw] -translate-x-1/2 truncate rounded-xl px-4 py-2 text-xs shadow-[0_8px_24px_rgba(0,0,0,0.32)] ${tone}`}>
            {text}
        </div>
    );
};

type Props = {
    theme: Theme;
    isDaylight: boolean;
    onBack: () => void;
    /** 在线浏览区播放注入（队列即当前列表）。 */
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
};

type LxTab = LxSurfaceTab;

export const LxSourceSurface: React.FC<Props> = ({ theme, isDaylight, onBack, onPlaySong }) => {
    const { t } = useTranslation();
    const isDesktop = Boolean(getLxSourceBridge());
    // 默认落在「在线浏览」：进入版块立刻看到榜单/搜索等内容，管理项作为并列标签随时可达。
    // 标签本身也持久化：离开版块再回来仍停在原标签。
    const tab = useLxBrowseMemoryStore(state => state.surfaceTab);
    const setTab = useLxBrowseMemoryStore(state => state.setSurfaceTab);
    const setPendingOpen = useLxBrowseMemoryStore(state => state.setPendingOpen);
    // 版块内点播都经这里：先记进试听列表，再交给应用播放（单一收口，各标签不用各自埋点）。
    const addAudition = useLxAuditionStore(state => state.add);
    const handlePlaySong = useCallback((song: SongResult, queue: SongResult[]) => {
        addAudition(song);
        onPlaySong(song, queue);
    }, [addAudition, onPlaySong]);
    // 收藏页点了某个收藏歌单：切到「在线浏览」并由浏览面板消费这次打开请求。
    const handleOpenPlaylist = useCallback((collection: OmniCollection) => {
        setPendingOpen(collection);
        setTab('browse');
    }, [setPendingOpen, setTab]);

    const tabs: Array<{ id: LxTab; labelKey: string; Icon: typeof Search }> = [
        { id: 'browse', labelKey: 'lxSource.tabBrowse', Icon: Search },
        { id: 'audition', labelKey: 'lxSource.tabAudition', Icon: Headphones },
        { id: 'favorites', labelKey: 'lxSource.tabFavorites', Icon: Heart },
        { id: 'manager', labelKey: 'lxSource.tabManager', Icon: Settings },
        { id: 'download', labelKey: 'lxSource.tabDownload', Icon: Download },
    ];

    const tabClass = (isActive: boolean) => `flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${isActive
        ? 'text-white shadow-sm'
        : isDaylight
            ? 'text-zinc-600 hover:bg-black/5'
            : 'text-white/65 hover:bg-white/10'}`;

    return (
        <>
            <div
                className="absolute inset-0 z-10 overflow-y-auto"
                style={{ backgroundColor: theme.backgroundColor }}
            >
                <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 pt-8 pb-4">
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label={t('lxSource.back')}
                        className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${isDaylight
                            ? 'text-zinc-600 hover:bg-black/5 hover:text-zinc-900'
                            : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
                    >
                        <ArrowLeft size={16} />
                        {t('lxSource.back')}
                    </button>
                    <div className="min-w-0 flex-1">
                        <h1 className={`flex items-center gap-2 text-lg font-semibold ${isDaylight ? 'text-zinc-900' : 'text-white'}`}>
                            <Radio size={18} style={{ color: theme.accentColor }} />
                            {t('lxSource.title')}
                        </h1>
                        <p className={`mt-0.5 truncate text-xs ${isDaylight ? 'text-zinc-500' : 'text-white/50'}`}>
                            {t('lxSource.subtitle')}
                        </p>
                    </div>
                </header>

                {isDesktop ? (
                    <>
                        <nav className={`mx-auto mb-4 flex w-full max-w-3xl items-center gap-1 rounded-full border p-1 ${isDaylight
                            ? 'border-black/5 bg-black/[0.03]'
                            : 'border-white/10 bg-white/5'}`}>
                            {tabs.map(({ id, labelKey, Icon }) => {
                                const isActive = tab === id;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setTab(id)}
                                        className={tabClass(isActive)}
                                        style={isActive ? { backgroundColor: theme.accentColor } : undefined}
                                    >
                                        <Icon size={13} />
                                        {t(labelKey)}
                                    </button>
                                );
                            })}
                        </nav>

                        {/* 在线浏览常驻挂载：切到别的标签只是隐藏，回来后搜索结果 / 打开的歌单都还在，也不会重复请求。 */}
                        <div className={tab === 'browse' ? undefined : 'hidden'}>
                            <LxBoardBrowser
                                isDaylight={isDaylight}
                                accentColor={theme.accentColor}
                                onPlaySong={handlePlaySong}
                            />
                        </div>
                        {tab === 'audition' && (
                            <LxAuditionPanel
                                isDaylight={isDaylight}
                                accentColor={theme.accentColor}
                                onPlaySong={handlePlaySong}
                            />
                        )}
                        {tab === 'favorites' && (
                            <LxFavoritesPanel
                                isDaylight={isDaylight}
                                accentColor={theme.accentColor}
                                onPlaySong={handlePlaySong}
                                onOpenPlaylist={handleOpenPlaylist}
                            />
                        )}
                        {tab === 'manager' && (
                            <LxSourceManager isDaylight={isDaylight} accentColor={theme.accentColor} />
                        )}
                        {tab === 'download' && (
                            <LxDownloadPanel isDaylight={isDaylight} accentColor={theme.accentColor} />
                        )}
                    </>
                ) : (
                    <p className={`mx-auto max-w-3xl px-6 text-sm ${isDaylight ? 'text-zinc-500' : 'text-white/50'}`}>
                        {t('lxSource.desktopOnly')}
                    </p>
                )}
            </div>
            <DownloadNoticeToast isDaylight={isDaylight} />
        </>
    );
};
