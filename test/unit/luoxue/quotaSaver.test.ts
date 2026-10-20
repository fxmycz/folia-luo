import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import { getMusicUrl, invalidateMusicUrlCache } from '../../../src/luoxue/sdk';
import { setCurrentSource, setUserApiRuntime } from '../../../src/luoxue/sdk/api-source';
import {
    invalidateLuoxueCachedPlaybackUrl,
    isLuoxuePlaybackSong,
    shouldSkipLuoxuePrefetch,
} from '../../../src/luoxue/provider/quotaPolicy';
import { useLuoxueSettingsStore } from '../../../src/luoxue/settings/useLuoxueSettingsStore';
import { LUOXUE_PROVIDER_ID } from '../../../src/luoxue/model/luoxueSong';

// test/unit/luoxue/quotaSaver.test.ts
// 自定义音源脚本按次计费（例如每日 300 次，重播同一首不扣点）。这里用假脚本数调用次数，
// 验证「同一首歌同一音质只问脚本一次」与「省点模式不预取」两条策略确实生效。
// 播放地址缓存是模块级状态，所以每个用例各用一首歌（songmid 不同），避免互相串味。

/** 假脚本：每被问一次地址就记一笔，用来代替真实计费音源的扣点计数。 */
const scriptCalls: Array<{ source: string; songmid: string; quality: string }> = [];

const installFakeScript = (): void => {
    setUserApiRuntime({
        getApis: (source: string) => ({
            getMusicUrl: async (info: { songmid: string }, quality: string) => {
                scriptCalls.push({ source, songmid: info.songmid, quality });
                if (info.songmid === 'always-fails') throw new Error('音源脚本取址失败');
                return `https://cdn.test/${source}/${info.songmid}-${quality}.mp3`;
            },
        }),
        getSourceIds: () => ['user_api_fake'],
        getSourceInfo: () => [],
    } as never);
    setCurrentSource('user_api_fake');
};

/** 洛雪歌曲：地址必须走自定义音源脚本（omni 里的 provider id 为 luoxue）。 */
const luoxueSong = (mediaId: string): SongResult =>
    ({
        id: mediaId,
        name: `song-${mediaId}`,
        sourceRef: { kind: 'online', providerId: LUOXUE_PROVIDER_ID, mediaId },
    }) as unknown as SongResult;

/** 其它在线音源：洛雪的额度策略不应影响到它。 */
const otherSong = (mediaId: string): SongResult =>
    ({
        id: mediaId,
        name: `song-${mediaId}`,
        sourceRef: { kind: 'online', providerId: 'netease', mediaId },
    }) as unknown as SongResult;

const lxInfo = (songmid: string, source = 'kg') => ({ songmid, source }) as never;

describe('洛雪播放地址缓存（计费音源只问一次）', () => {
    beforeEach(() => {
        scriptCalls.length = 0;
        installFakeScript();
    });

    it('同一首歌同一音质重复取址只问脚本一次', async () => {
        await getMusicUrl('user_api_fake', lxInfo('repeat-1'), '320k');
        await getMusicUrl('user_api_fake', lxInfo('repeat-1'), '320k');
        await getMusicUrl('user_api_fake', lxInfo('repeat-1'), '320k');

        expect(scriptCalls).toHaveLength(1);
    });

    it('并发取址（播放与预取同时发起）也只问脚本一次', async () => {
        const [first, second] = await Promise.all([
            getMusicUrl('user_api_fake', lxInfo('concurrent-1'), '320k'),
            getMusicUrl('user_api_fake', lxInfo('concurrent-1'), '320k'),
        ]);

        expect(scriptCalls).toHaveLength(1);
        expect(first).toBe(second);
    });

    it('换音质要重新取址（不同档位是不同的资源）', async () => {
        const normal = await getMusicUrl('user_api_fake', lxInfo('quality-1'), '128k');
        const high = await getMusicUrl('user_api_fake', lxInfo('quality-1'), '320k');

        expect(scriptCalls).toHaveLength(2);
        expect(normal).not.toBe(high);
    });

    it('缓存过期后重新取址', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            await getMusicUrl('user_api_fake', lxInfo('ttl-1'), '320k');
            vi.setSystemTime(new Date('2026-01-01T01:30:00Z'));
            await getMusicUrl('user_api_fake', lxInfo('ttl-1'), '320k');

            expect(scriptCalls).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('取址失败不写缓存（下一次仍需重试，不能拿错误当结果）', async () => {
        await expect(getMusicUrl('user_api_fake', lxInfo('always-fails'), '320k')).rejects.toThrow();
        await expect(getMusicUrl('user_api_fake', lxInfo('always-fails'), '320k')).rejects.toThrow();

        expect(scriptCalls).toHaveLength(2);
    });

    it('主动丢弃后重新取址（刷新播放地址时用）', async () => {
        await getMusicUrl('user_api_fake', lxInfo('invalidate-1'), '320k');
        invalidateMusicUrlCache('invalidate-1');
        await getMusicUrl('user_api_fake', lxInfo('invalidate-1'), '320k');

        expect(scriptCalls).toHaveLength(2);
    });
});

describe('洛雪省点模式（不预取邻居歌曲）', () => {
    beforeEach(() => {
        scriptCalls.length = 0;
        installFakeScript();
    });

    afterEach(() => {
        useLuoxueSettingsStore.getState().setQuotaSaver(true);
    });

    it('只有洛雪歌曲会被拦下，其它音源的预取行为不变', () => {
        expect(isLuoxuePlaybackSong(luoxueSong('a'))).toBe(true);
        expect(isLuoxuePlaybackSong(otherSong('a'))).toBe(false);

        expect(shouldSkipLuoxuePrefetch(luoxueSong('a'))).toBe(true);
        expect(shouldSkipLuoxuePrefetch(otherSong('a'))).toBe(false);
    });

    it('关掉省点模式后恢复预取', () => {
        useLuoxueSettingsStore.getState().setQuotaSaver(false);

        expect(shouldSkipLuoxuePrefetch(luoxueSong('a'))).toBe(false);
        expect(shouldSkipLuoxuePrefetch(otherSong('a'))).toBe(false);
    });

    it('丢弃播放地址缓存只对洛雪歌曲生效', async () => {
        const trackId = 'scope-1';
        await getMusicUrl('user_api_fake', lxInfo(trackId), '320k');

        // 非洛雪歌曲：空操作，缓存原样保留，不会多问脚本一次。
        invalidateLuoxueCachedPlaybackUrl(otherSong(trackId));
        await getMusicUrl('user_api_fake', lxInfo(trackId), '320k');
        expect(scriptCalls).toHaveLength(1);

        // 洛雪歌曲：真的丢掉了，下一次要重新问脚本。
        invalidateLuoxueCachedPlaybackUrl(luoxueSong(trackId));
        await getMusicUrl('user_api_fake', lxInfo(trackId), '320k');
        expect(scriptCalls).toHaveLength(2);
    });
});
