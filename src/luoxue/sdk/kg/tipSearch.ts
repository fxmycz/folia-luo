import { httpFetch } from '../request'

// src/luoxue/sdk/kg/tipSearch.ts
// 搜索联想词（酷狗）：官方 getSearchTip 接口，一次 10 条，取 HintInfo。
// 上游 ikun 拿到的响应是 [{ RecordDatas }]，实测现在外层多包了一层 data，两种结构都认。
// 与 hotSearch 一致：一个实例只保留最后一次请求，新输入进来先取消在途的那次（联想是高频请求）。

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
      `https://searchtip.kugou.com/getSearchTip?MusicTipCount=10&keyword=${encodeURIComponent(str)}`,
      { headers: { referer: 'https://www.kugou.com/' } }
    )
    this.requestObj = requestObj
    const { body } = await requestObj.promise
    const groups: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
    const list: string[] = []
    groups.forEach(group => {
      if (!Array.isArray(group?.RecordDatas)) return
      group.RecordDatas.forEach((record: any) => {
        const hint = record?.HintInfo
        if (typeof hint === 'string' && hint && !list.includes(hint)) list.push(hint)
      })
    })
    return list
  },
}
