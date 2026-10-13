import { useCallback } from 'react';
import type { SongResult } from '../../types';
import { useLxDownloadStore } from '../../stores/useLxDownloadStore';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { lxMusicInfoFromSourceRef } from '../../services/lxSource/lxNormalize';

// src/components/lxSource/useLxSongDownload.ts
// 版块内各标签共用的下载入口：从歌曲 sourceRef 取回脚本要的 { source, musicInfo }，
// 音质用全局偏好。收藏 / 试听等面板不必各自重写一遍。

export const useLxSongDownload = () => {
    const startDownload = useLxDownloadStore(state => state.start);
    const audioQuality = useAudioSettingsStore(state => state.audioQuality);

    return useCallback((song: SongResult) => {
        const ref = song.sourceRef;
        if (ref?.kind !== 'online') return;
        const { source, musicInfo } = lxMusicInfoFromSourceRef(ref.providerData);
        if (!source) return;
        void startDownload(
            {
                source,
                musicInfo: musicInfo as Record<string, unknown>,
                name: song.name,
                artist: song.artists.map(artist => artist.name).join('、'),
            },
            audioQuality,
        );
    }, [startDownload, audioQuality]);
};
