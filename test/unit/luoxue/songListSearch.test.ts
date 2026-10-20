import { beforeEach, describe, expect, it } from 'vitest';
import { setCurrentSource, setUserApiRuntime } from '../../../src/luoxue/sdk/api-source';
import { getSongListTags, searchSongLists } from '../../../src/luoxue/sdk';
import { normalizeLuoxueSongListTagGroups } from '../../../src/luoxue/services/luoxueCatalog';
import { searchLuoxueSongLists } from '../../../src/luoxue/provider/luoxueProvider';
import { LUOXUE_PROVIDER_ID } from '../../../src/luoxue/model/luoxueSong';

// test/unit/luoxue/songListSearch.test.ts
// 两个回归点：
// 1) 歌单分类是「分组 + 组内标签」两层。上一版直接把音源给的分组当标签渲染，而分组没有 id
//    （lx 各音源返回的是 `[{ name: '语种', list: [...] }]`），于是组内真正的标签既看不到、也切不到。
// 2) 搜索的「歌单」类别走音源脚本的 songList.search，参数要原样传下去、结果要按歌单映射。

const searchCalls: Array<{ source: string; keyword: string; page: number; limit: number }> = [];

/** 假脚本：按 kw 的形状给分组标签（热门标签故意用单数 hotTag，多数音源是这么命名的）。 */
const installFakeScript = (): void => {
    setUserApiRuntime({
        getApis: () => ({
            songList: {
                getTags: async () => ({
                    tags: [
                        { name: '语种', list: [{ id: 'lang-cn', name: '华语' }, { id: 'lang-en', name: '欧美' }] },
                        { name: '风格', list: [{ id: 'style-pop', name: '流行' }] },
                    ],
                    hotTag: [{ id: 'hot-1', name: '热门歌单' }],
                }),
                search: async (keyword: string, page: number, limit: number) => {
                    searchCalls.push({ source: 'user_api_fake', keyword, page, limit });
                    return {
                        list: [
                            { id: 'sl-1', name: '歌单甲', author: '小明', total: 12, picUrl: 'https://img.test/1.jpg' },
                            { id: 'sl-2', name: '歌单乙' },
                        ],
                        total: 2,
                        allPage: 1,
                    };
                },
            },
        }),
        getSourceIds: () => ['user_api_fake'],
        getSourceInfo: () => [],
    } as never);
    setCurrentSource('user_api_fake');
};

describe('歌单分类的两层结构（分组 → 组内标签）', () => {
    it('热门标签自成第一组，音源给的分组按组内标签收好', () => {
        const groups = normalizeLuoxueSongListTagGroups(
            [{ name: '语种', list: [{ id: 'lang-cn', name: '华语' }] }, { name: '风格', list: [{ id: 's1', name: '流行' }] }],
            [{ id: 'hot-1', name: '热门歌单' }],
        );
        expect(groups.map(group => group.name)).toEqual(['热门', '语种', '风格']);
        expect(groups[0].tags.map(tag => tag.id)).toEqual(['hot-1']);
        expect(groups[1].tags.map(tag => tag.name)).toEqual(['华语']);
    });

    it('一维标签按 parent_name 归组，没有归属的并进「分类」', () => {
        const groups = normalizeLuoxueSongListTagGroups([
            { id: 'a', name: '民谣' },
            { id: 'b', name: '摇滚', parent_name: '风格' },
            { id: 'c', name: '爵士', parent_name: '风格' },
        ], []);
        expect(groups.map(group => group.name)).toEqual(['分类', '风格']);
        expect(groups[0].tags.map(tag => tag.name)).toEqual(['民谣']);
        expect(groups[1].tags.map(tag => tag.name)).toEqual(['摇滚', '爵士']);
    });

    it('拿不到分类时返回空数组而不是抛错', () => {
        expect(normalizeLuoxueSongListTagGroups(undefined, undefined)).toEqual([]);
        expect(normalizeLuoxueSongListTagGroups('oops', [null, 1, {}])).toEqual([]);
    });

    it('同名分组合成一组：QQ 的「热门」既有热搜标签、又是自己的一个分组', () => {
        const groups = normalizeLuoxueSongListTagGroups(
            [{ name: '热门', list: [{ id: 1, name: 'KTV金曲' }] }, { name: '主题', list: [{ id: 2, name: '情歌' }] }],
            [{ id: 3, name: '经典老歌' }],
        );
        expect(groups.map(group => group.name)).toEqual(['热门', '主题']);
        expect(groups[0].tags.map(tag => tag.name)).toEqual(['经典老歌', 'KTV金曲']);
    });

    it('合并同名分组时按 id 去重，不会出现两条一样的标签', () => {
        const groups = normalizeLuoxueSongListTagGroups(
            [{ name: '热门', list: [{ id: 7, name: '经典老歌' }, { id: 8, name: '情歌' }] }],
            [{ id: 7, name: '经典老歌' }],
        );
        expect(groups[0].tags.map(tag => tag.id)).toEqual([7, 8]);
    });
});

describe('搜索歌单（songList.search）', () => {
    beforeEach(() => {
        searchCalls.length = 0;
        installFakeScript();
    });

    it('关键词与页码原样交给音源脚本，返回结构按列表归一', async () => {
        const result = await searchSongLists('user_api_fake', '周杰伦', 2, 30);
        expect(searchCalls).toEqual([{ source: 'user_api_fake', keyword: '周杰伦', page: 2, limit: 30 }]);
        expect((result.list as unknown as Array<{ name: string }>).map(item => item.name)).toEqual(['歌单甲', '歌单乙']);
        expect(result.total).toBe(2);
    });

    it('结果映射成歌单集合：id 字符串化，封面 / 发布者 / 曲目数只在音源给了才带', async () => {
        const page = await searchLuoxueSongLists('user_api_fake', '周杰伦', 1, 30);
        expect(page.collections).toHaveLength(2);
        expect(page.collections[0]).toMatchObject({
            providerId: LUOXUE_PROVIDER_ID,
            id: 'sl-1',
            name: '歌单甲',
            type: 'playlist',
            coverUrl: 'https://img.test/1.jpg',
            publisher: '小明',
            trackCount: 12,
        });
        expect(page.collections[1].coverUrl).toBeUndefined();
        expect(page.collections[1].publisher).toBeUndefined();
        expect(page.collections[1].trackCount).toBeUndefined();
        expect(page.total).toBe(2);
    });

    it('标签接口把 hotTag 与 hotTags 两种命名都收成 hotTags', async () => {
        const data = await getSongListTags('user_api_fake');
        expect((data.hotTags as Array<{ id: string }>).map(tag => tag.id)).toEqual(['hot-1']);
        expect(data.tags.map(tag => tag.name)).toEqual(['语种', '风格']);
    });
});
