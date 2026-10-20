import React, { useMemo, useState } from 'react';
import type { SongResult } from '../../types';
import ThemedDialog from '../../components/shared/ThemedDialog';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import type { LxQuality } from '../sdk';
import { resolveLuoxueSource } from '../model/luoxueSong';
import { getBrowsePlatform } from '../provider/activeSource';
import { getLuoxueSupportedQualitys } from '../provider/luoxueProvider';
import { LUOXUE_DOWNLOAD_QUALITY_OPTIONS, LUOXUE_QUALITY_LABELS } from '../settings/useLuoxueSettingsStore';
import { useLuoxueDownloadStore } from '../store/useLuoxueDownloadStore';
import { luoxueSourceLabel } from './LuoxueSongList';

// src/luoxue/components/LuoxueDownloadDialog.tsx
// 点「下载」时弹出的音质选择框（对齐 lx 的下载弹窗）：档位选项来自「当前音源脚本对这首歌所属平台声明的 qualitys」，
// 各平台支持范围不同，所以不做成全局设置项、每次下载当场选；脚本没声明档位时退回到通用档位列表。

export type LuoxueDownloadDialogProps = {
    song: SongResult;
    onClose: () => void;
};

const LuoxueDownloadDialog: React.FC<LuoxueDownloadDialogProps> = ({ song, onClose }) => {
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const startDownload = useLuoxueDownloadStore(state => state.startDownload);
    // 歌曲自带它属于哪个 lx 音源；音质支持范围是按音源问的。
    const { lxSource } = resolveLuoxueSource(song, getBrowsePlatform());
    const options = useMemo(() => {
        const supported = getLuoxueSupportedQualitys(lxSource) as LxQuality[];
        return supported.length
            ? { list: supported, fromScript: true }
            : { list: [...LUOXUE_DOWNLOAD_QUALITY_OPTIONS], fromScript: false };
    }, [lxSource]);
    const [quality, setQuality] = useState<LxQuality>(options.list[0] ?? '320k');

    const artists = (song.artists ?? []).map(artist => artist.name).filter(Boolean).join('、') || '未知歌手';
    const pillClass = `rounded-full border px-3 py-1.5 text-xs transition-colors ${
        isDaylight ? 'border-black/10 hover:bg-black/[0.06]' : 'border-white/10 hover:bg-white/[0.08]'
    }`;

    return (
        <ThemedDialog
            isOpen
            isDaylight={isDaylight}
            onClose={onClose}
            title="选择下载音质"
            description={`${song.name} - ${artists}`}
            footer={(
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className={`rounded-full px-4 py-2 text-sm transition-colors ${isDaylight ? 'hover:bg-black/[0.06]' : 'hover:bg-white/[0.08]'}`}
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            startDownload(song, quality);
                            onClose();
                        }}
                        className="rounded-full px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                        style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                    >
                        下载
                    </button>
                </>
            )}
        >
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                    {options.list.map(item => {
                        const active = item === quality;
                        return (
                            <button
                                key={item}
                                type="button"
                                onClick={() => setQuality(item)}
                                className={pillClass}
                                style={active
                                    ? { backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)', borderColor: 'transparent' }
                                    : {}}
                            >
                                {LUOXUE_QUALITY_LABELS[item] ?? item}
                            </button>
                        );
                    })}
                </div>
                <p className={`text-xs ${isDaylight ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    {options.fromScript
                        ? `档位来自当前音源脚本对「${luoxueSourceLabel(lxSource)}」声明的支持范围。`
                        : `当前音源脚本未声明「${luoxueSourceLabel(lxSource)}」的档位（可先在「音源」面板导入脚本），将按通用档位请求。`}
                </p>
            </div>
        </ThemedDialog>
    );
};

export default LuoxueDownloadDialog;
