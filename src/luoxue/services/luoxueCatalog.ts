import type { OmniPage, ProviderCollection } from '../../types/onlineMusic';
import type { SongResult, UnifiedSong } from '../../types';
import { omni } from '../../services/onlineMusic/omni';
import { getHotSearch, getSongListTags, getTipSearch } from '../sdk';
import type { LxSongListTag } from '../sdk';
import { LUOXUE_PROVIDER_ID } from '../model/luoxueSong';
import { hydrateLuoxueCovers } from '../provider/coverHydration';
import { listLuoxueBoards, listLuoxueSongLists, searchLuoxueSongLists as searchLuoxueSongListsInSource } from '../provider/luoxueProvider';
import { getBrowsePlatform } from '../provider/activeSource';

// src/luoxue/services/luoxueCatalog.ts
// 洛雪版块的数据服务层。歌曲级别的操作（搜索、集合取曲目）一律走 omni，与 folia 其余部分同一条路；
// 只有 lx 独有的目录能力（排行榜列表、歌单分类与歌单列表）没有 omni 对应项，才直接问 SDK。
// 组件不直接 import SDK / provider，只调这里。

/** 洛雪在 omni 里的 provider id（组件拼请求时用它）。 */
export const luoxueProviderId = LUOXUE_PROVIDER_ID;

/** 按关键词搜索当前音源。 */
export const searchLuoxueSongs = (query: string, page: { limit: number; offset: number }): Promise<OmniPage<UnifiedSong>> =>
    omni.searchProviderSongs(LUOXUE_PROVIDER_ID, query, page)
        .then(result => {
            // 搜索结果里通常没有封面，拿到后就顺手补齐（不阻塞列表渲染）。
            hydrateLuoxueCovers(result.items as unknown as SongResult[]);
            return result;
        });

/** 热搜词的展示上限：各平台返回条数差别很大（酷狗一次能回几百条，堆满整屏、把结果顶出可视区），只留前 20 条。 */
const HOT_SEARCH_LIMIT = 20;

/** 当前音源的热搜词（去重后取前 20 条）。 */
export const getLuoxueHotSearch = async (): Promise<string[]> => {
    const list = await getHotSearch(getBrowsePlatform());
    const seen = new Set<string>();
    const result: string[] = [];
    for (const word of Array.isArray(list) ? list : []) {
        const text = typeof word === 'string' ? word.trim() : '';
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
        if (result.length >= HOT_SEARCH_LIMIT) break;
    }
    return result;
};

/** 当前音源的搜索联想词（音源未实现时为空数组，见 sdk 的 getTipSearch）。 */
export const getLuoxueSuggest = (keyword: string): Promise<string[]> => getTipSearch(getBrowsePlatform(), keyword);

/** 当前音源的排行榜列表（lx 独有：omni 契约里没有「排行榜目录」）。 */
export const getLuoxueBoards = (): Promise<ProviderCollection[]> => listLuoxueBoards(getBrowsePlatform());

/** 歌单分类里的一个分组（如「热门」「语种」「风格」）与组内的标签。 */
export type LuoxueSongListTagGroup = {
    name: string;
    tags: LxSongListTag[];
};

/** 热门标签的分组名：lx desktop 也把它当作第一个分组摆在最前面。 */
const HOT_TAG_GROUP_NAME = '热门';
/** 一维标签（个别音源不给分组名）统一并进这一组。 */
const UNGROUPED_TAG_GROUP_NAME = '分类';

const readTagArray = (value: unknown): LxSongListTag[] =>
    Array.isArray(value)
        ? value.filter((item): item is LxSongListTag => Boolean(item) && typeof item === 'object' && typeof (item as LxSongListTag).name === 'string')
        : [];

/** 往同名分组里加标签（按 id 去重）。QQ 的「热门」既是自己的一个分组、又是热搜标签组的名字，两者合成一组。 */
const pushIntoGroup = (groups: LuoxueSongListTagGroup[], name: string, tags: LxSongListTag[]): void => {
    const existing = groups.find(group => group.name === name);
    if (!existing) {
        if (tags.length) groups.push({ name, tags });
        return;
    }
    const seen = new Set(existing.tags.map(tag => String(tag.id)));
    for (const tag of tags) {
        const key = String(tag.id);
        if (seen.has(key)) continue;
        seen.add(key);
        existing.tags.push(tag);
    }
};

/**
 * 把各音源的标签结构统一成「分组 + 组内标签」两层。
 *
 * 歌单面板此前直接把 SDK 报出来的数组当标签渲染，而那其实是**分组**（kw / kg / tx / wy / git 都返回
 * `[{ name: '语种', list: [...] }]`）：于是界面上只有「语种 / 主题 / 风格」这类组名可点，组内真正的标签
 * 既看不到、也切不到（分组没有 id，点它只会把 activeTagId 置空）。这里统一形状后，面板才能先点分组展开、
 * 再点组内标签切换列表。个别音源只给一维标签时，按 parent_name 归类，没有归属的并进「分类」；
 * 重名的分组（QQ 的「热门」与热搜标签组同名）合成一组。
 */
export const normalizeLuoxueSongListTagGroups = (tags: unknown, hotTags: unknown): LuoxueSongListTagGroup[] => {
    const groups: LuoxueSongListTagGroup[] = [];
    pushIntoGroup(groups, HOT_TAG_GROUP_NAME, readTagArray(hotTags));

    for (const entry of readTagArray(tags)) {
        const children = readTagArray(entry.list);
        if (children.length) {
            pushIntoGroup(groups, entry.name, children);
            continue;
        }
        const parent = typeof entry.parent_name === 'string' && entry.parent_name.trim() ? entry.parent_name.trim() : UNGROUPED_TAG_GROUP_NAME;
        pushIntoGroup(groups, parent, [entry]);
    }
    return groups;
};

/** 当前音源的歌单分类（分组 + 组内标签；热门标签作为第一组）。 */
export const getLuoxueSongListTags = (): Promise<LuoxueSongListTagGroup[]> =>
    getSongListTags(getBrowsePlatform()).then(data => normalizeLuoxueSongListTagGroups(data?.tags, data?.hotTags));

/** 当前音源按分类标签翻页取歌单。 */
export const getLuoxueSongLists = (tagId: string, page: { limit: number; offset: number }): Promise<{ collections: ProviderCollection[]; total?: number; hasMore: boolean }> =>
    listLuoxueSongLists(getBrowsePlatform(), tagId, Math.floor(page.offset / Math.max(page.limit, 1)) + 1, page.limit)
        .then(result => ({
            collections: result.collections,
            total: result.total,
            hasMore: result.collections.length >= page.limit,
        }));

/** 按关键词翻页搜歌单（搜索面板的「歌单」类别）。 */
export const searchLuoxueSongLists = (query: string, page: { limit: number; offset: number }): Promise<{ collections: ProviderCollection[]; total?: number; hasMore: boolean }> =>
    searchLuoxueSongListsInSource(getBrowsePlatform(), query, Math.floor(page.offset / Math.max(page.limit, 1)) + 1, page.limit)
        .then(result => ({
            collections: result.collections,
            total: result.total,
            hasMore: result.collections.length >= page.limit,
        }));

/** 打开一个洛雪集合（排行榜 / 歌单）取曲目：仍然经 omni，provider 按集合自带的 providerData 分派。 */
export const getLuoxueCollectionTracks = (collection: ProviderCollection, page: { limit: number; offset: number }): Promise<OmniPage<UnifiedSong>> =>
    omni.getCollectionTracks(collection, page)
        .then(result => {
            // 榜单 / 歌单里的歌曲同样常常没有封面，一并补齐。
            hydrateLuoxueCovers(result.items as unknown as SongResult[]);
            return result;
        });
