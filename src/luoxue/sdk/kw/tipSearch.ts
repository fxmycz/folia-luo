import { httpFetch } from '../request'

// src/luoxue/sdk/kw/tipSearch.ts
// 搜索联想词（酷我）：tips.kuwo.cn 的 t.s 接口，取 WORDITEMS 里的 RELWORD。
// 与 hotSearch / kg 的 tipSearch 一致：只保留最后一次请求，新输入先取消在途请求。

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
      `https://tips.kuwo.cn/t.s?corp=kuwo&newver=3&p2p=1&notrace=0&c=mbox&w=${encodeURIComponent(str)}&encoding=utf8&rformat=json`,
      { headers: { referer: 'http://www.kuwo.cn/', origin: 'http://www.kuwo.cn' } }
    )
    this.requestObj = requestObj
    const { body } = await requestObj.promise
    const items = body?.WORDITEMS
    if (!Array.isArray(items)) return []
    return items
      .map((item: any) => (typeof item?.RELWORD === 'string' ? item.RELWORD : ''))
      .filter(word => word.length > 0)
  },
}
