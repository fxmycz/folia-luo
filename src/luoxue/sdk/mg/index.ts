import { apis } from '../api-source'
import leaderboard from './leaderboard'
import songList from './songList'
import musicSearch from './musicSearch'
import pic from './pic'
import lyric from './lyric'
import hotSearch from './hotSearch'

// src/luoxue/sdk/mg/index.ts

const mg = {
  songList,
  musicSearch,
  leaderboard,
  hotSearch,
  getMusicUrl(songInfo: any, type: string): any {
    return apis('mg').getMusicUrl(songInfo, type)
  },
  getLyric(songInfo: any): any {
    return lyric.getLyric(songInfo)
  },
  getPic(songInfo: any): any {
    return pic.getPic(songInfo)
  },
  getMusicDetailPageUrl(songInfo: any): string {
    return `http://music.migu.cn/v3/music/song/${songInfo.copyrightId}`
  },
}

export default mg
