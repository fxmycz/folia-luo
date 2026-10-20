/**
 * 音源内部使用的通用工具方法
 *
 * 对应 ikun 里 `@renderer/utils` / `@common/utils` 中被音源真正用到的部分：
 * decodeName（原实现依赖 window.DOMParser，这里改为无 DOM 的等价实现）、
 * formatPlayTime、sizeFormate、dateFormat、formatPlayCount。
 */

// src/luoxue/sdk/helpers.ts

const numFix = (n: number): string => (n < 10 ? `0${n}` : n.toString())

const encodeNames: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/**
 * 解码 HTML 实体（原实现用 `new DOMParser().parseFromString(str, 'text/html').body.textContent`）
 *
 * 音源接口返回的歌名/歌手里常有 `&amp;`、`&#039;` 一类的转义，这里用正则做等价的解码，
 * 以便 SDK 在没有 DOM 的环境（主进程/工具进程）里也能运行。
 */
export const decodeName = (str: string | null | undefined = ''): string => {
  if (!str) return ''
  return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code.charAt(0) === '#') {
      const num =
        code.charAt(1) === 'x' || code.charAt(1) === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10)
      return Number.isFinite(num) ? String.fromCodePoint(num) : match
    }
    return encodeNames[code.toLowerCase()] ?? match
  })
}

/** 把秒数格式化成 `mm:ss`，为 0 时返回 `--/--` */
export const formatPlayTime = (time: number): string => {
  const m = Math.trunc(time / 60)
  const s = Math.trunc(time % 60)
  return m === 0 && s === 0 ? '--/--' : `${numFix(m)}:${numFix(s)}`
}

/** 把字节数格式化成带单位的可读字符串 */
export const sizeFormate = (size: number): string => {
  // https://gist.github.com/thomseddon/3511330
  if (!size) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const number = Math.floor(Math.log(size) / Math.log(1024))
  return `${(size / Math.pow(1024, Math.floor(number))).toFixed(2)} ${units[number]}`
}

/** 将字符串/时间戳转成时间对象，非法输入返回空字符串 */
export const toDateObj = (date: any): Date | '' => {
  if (!date) return ''
  switch (typeof date) {
    case 'string':
      if (!date.includes('T')) date = date.split('.')[0].replace(/-/g, '/')
    // eslint-disable-next-line no-fallthrough
    case 'number':
      date = new Date(date)
    // eslint-disable-next-line no-fallthrough
    case 'object':
      break
    default:
      return ''
  }
  return date
}

/**
 * 时间格式化
 * @param _date 时间
 * @param format Y-M-D h:m:s（Y年 M月 D日 h时 m分 s秒）
 */
export const dateFormat = (_date: any, format = 'Y-M-D h:m:s'): string => {
  const date = toDateObj(_date)
  if (!date) return ''
  return format
    .replace('Y', date.getFullYear().toString())
    .replace('M', numFix(date.getMonth() + 1))
    .replace('D', numFix(date.getDate()))
    .replace('h', numFix(date.getHours()))
    .replace('m', numFix(date.getMinutes()))
    .replace('s', numFix(date.getSeconds()))
}

/** 格式化播放量（万/亿） */
export const formatPlayCount = (num: number): string => {
  if (num > 100000000) return `${Math.trunc(num / 10000000) / 10}亿`
  if (num > 10000) return `${Math.trunc(num / 1000) / 10}万`
  return String(num)
}
