import { httpFetch } from '../request'

// src/luoxue/sdk/wy/tipSearch.ts
// 搜索联想词（网易云）：上游 ikun 走 weapi 的 search/suggest/web，这里改用公开的
// api/search/suggest/keyword（不需要加密参数，也不需要登录 cookie），取 result.allMatch 里的 keyword。
// 只要关键词、不取歌名——联想列表就是要短。与 kg / kw / tx 的 tipSearch 一致：只保留最后一次请求。

export default {
  requestObj: null as { cancelHttp: () => void } | null,
  cancel(): void {
    if (this.requestObj) this.requestObj.cancelHttp()
    this.requestObj = null
  },
  async search(keyword: string): Promise<string[]> {
    const str = keyword.trim()
    if (!str) return []
    this.cancel()
    const requestObj = httpFetch(
      `https://music.163.com/api/search/suggest/keyword?csrf_token=&s=${encodeURIComponent(str)}`,
      { headers: { referer: 'https://music.163.com/', origin: 'https://music.163.com' } }
    )
    this.requestObj = requestObj
    const { body } = await requestObj.promise
    const items = body?.result?.allMatch
    if (!Array.isArray(items)) return []
    return items
      .map((item: any) => (typeof item?.keyword === 'string' ? item.keyword : ''))
      .filter(word => word.length > 0)
  },
}
