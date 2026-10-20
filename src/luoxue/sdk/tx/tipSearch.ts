import { httpFetch } from '../request'

// src/luoxue/sdk/tx/tipSearch.ts
// 搜索联想词（QQ 音乐）：smartbox_new.fcg，取 data.song.itemlist，拼成「歌名 - 歌手」。
// 与 kg / kw 的 tipSearch 一致：只保留最后一次请求，新输入先取消在途请求。

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
      `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?is_xml=0&format=json&key=${encodeURIComponent(str)}&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`,
      { headers: { referer: 'https://y.qq.com/portal/player.html' } }
    )
    this.requestObj = requestObj
    const { body } = await requestObj.promise
    const items = body?.data?.song?.itemlist
    if (!Array.isArray(items)) return []
    return items
      .map((item: any) => [item?.name, item?.singer].filter((part: unknown) => typeof part === 'string' && part).join(' - '))
      .filter(word => word.length > 0)
  },
}
