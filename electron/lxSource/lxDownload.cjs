// electron/lxSource/lxDownload.cjs
// 自定义音源的下载队列（Phase 3）：用宿主窗口里的用户脚本解析出播放直链后，由主进程流式下载到
// 临时文件，完成后再 rename 成最终文件。并发 2、FIFO、可取消，进度经 onProgress 回传。
//
// 依赖全部从外部注入（host / store / fetchImpl），模块本身不 require electron，
// 便于对纯逻辑（文件名净化、音质降级、队列调度）做离线单测。
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { embedTags } = require('./audioTag.cjs');

// 同时下载的任务数；洛雪默认也是 2。
const MAX_CONCURRENT = 2;
// 单任务进度回传的最小间隔，避免大文件把 IPC 打满。
const PROGRESS_THROTTLE_MS = 200;
// 拖过这个时长的任务视为卡死，直接失败（宿主解析 + 网络合计上限）。
const TASK_TIMEOUT_MS = 30 * 60 * 1000;

// Folia 的统一音质偏好 → 洛雪脚本使用的音质标识；与 lxProvider 保持一致。
const QUALITY_FOR_PREFERENCE = {
  standard: '128k',
  high: '320k',
  lossless: 'flac',
  hires: 'flac24bit',
};
const QUALITY_ORDER = ['128k', '320k', 'flac', 'flac24bit'];
const EXTENSION_FOR_QUALITY = {
  '128k': 'mp3',
  '320k': 'mp3',
  flac: 'flac',
  flac24bit: 'flac',
};
// 直链里出现这些扩展名时优先采信，落盘后缀与真实编码保持一致。
const KNOWN_AUDIO_EXTENSIONS = ['mp3', 'flac', 'm4a', 'aac', 'wav', 'ape', 'ogg', 'opus'];

const text = (value) => (value == null ? '' : String(value));

/**
 * 净化文件名字段：去掉 Windows / macOS / Linux 下的非法字符与控制字符，收敛空白，去尾部点与空格。
 * 纯函数，供单测直接断言。
 */
const sanitizeFileName = (value) => text(value)
  .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/[. ]+$/g, '');

/** `{artist} - {name}.{ext}`，两端各兜一个占位名，整体限长避免触碰文件系统上限。 */
const buildDownloadFileName = (artist, name, extension) => {
  const safeArtist = sanitizeFileName(artist) || '未知歌手';
  const safeName = sanitizeFileName(name) || '未知歌曲';
  const stem = `${safeArtist} - ${safeName}`.slice(0, 150).replace(/[. ]+$/g, '') || '未知歌曲';
  const ext = sanitizeFileName(extension) || 'mp3';
  return `${stem}.${ext}`;
};

/** 在音源声明的音质里挑最接近偏好的一档：优先同名档，其次不高于它的最高档，最后退到最低档。 */
const pickDownloadQuality = (preference, supported) => {
  const desired = QUALITY_FOR_PREFERENCE[preference] ?? '128k';
  const list = Array.isArray(supported) ? supported : [];
  const allowed = QUALITY_ORDER.filter(quality => list.includes(quality));
  if (!allowed.length) return desired;
  if (allowed.includes(desired)) return desired;
  const desiredRank = QUALITY_ORDER.indexOf(desired);
  const lower = allowed.filter(quality => QUALITY_ORDER.indexOf(quality) < desiredRank);
  return lower.length ? lower[lower.length - 1] : allowed[0];
};

/** 落盘后缀：优先直链路径里的已知音频扩展名，其次按音质推断。 */
const extensionForQuality = (quality, url) => {
  try {
    const pathname = new URL(text(url)).pathname;
    const match = /\.([a-z0-9]{2,5})$/i.exec(pathname);
    const fromUrl = match ? match[1].toLowerCase() : '';
    if (KNOWN_AUDIO_EXTENSIONS.includes(fromUrl)) return fromUrl;
  } catch {
    // 非绝对 URL：忽略，走音质推断。
  }
  return EXTENSION_FOR_QUALITY[quality] ?? 'mp3';
};

/** 同目录重名时追加 ` (n)`。 */
const uniquePath = (dir, fileName) => {
  const extension = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  let candidate = path.join(dir, fileName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${counter})${extension}`);
    counter += 1;
  }
  return candidate;
};

/** 对外暴露的任务形态：过滤掉内部字段（musicInfo / 目录 / 控制器等）。 */
const toPublicTask = (record) => ({
  taskId: record.taskId,
  name: record.name,
  artist: record.artist,
  status: record.status,
  quality: record.quality,
  requestedQuality: record.requestedQuality,
  degraded: record.degraded,
  receivedBytes: record.receivedBytes,
  totalBytes: record.totalBytes,
  progress: record.progress,
  error: record.error,
  filePath: record.filePath,
  // 标签内嵌为非致命信息：失败也视为下载成功，仅记录状态供 UI 提示。
  tagged: record.tagged ?? false,
  tagError: record.tagError ?? null,
  createdAt: record.createdAt,
});

/** 规范化 lyric action 的返回：字符串或 { lyric } / { lyrics } / { lrc }。 */
const resolveLyricText = (raw) => {
  const value = raw?.data ?? raw;
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return text(value.lyric) || text(value.lyrics) || text(value.lrc) || '';
};

/** 规范化 pic action 的返回：字符串 URL 或 { url } / { pic }。 */
const resolveCoverUrl = (raw) => {
  const value = raw?.data ?? raw;
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return text(value.url) || text(value.pic) || '';
};

/**
 * 创建下载队列。
 * @param {object} options
 * @param {{ request: (payload: object) => Promise<any>, getStatus: () => { sources?: Record<string, { qualitys?: string[] }> } }} options.host 音源宿主
 * @param {{ get: (key: string) => unknown, set: (key: string, value: unknown) => void, delete: (key: string) => void }} options.store 设置仓储
 * @param {string} options.defaultDir 未配置时的默认下载目录
 * @param {(task: object) => void} [options.onProgress] 进度 / 状态变化回调
 * @param {typeof fetch} [options.fetchImpl] 便于测试注入；默认用全局 fetch
 * @param {(...args: any[]) => void} [options.warn]
 */
function createLxDownload({
  host,
  store,
  defaultDir,
  onProgress = () => {},
  fetchImpl,
  warn = console.warn,
} = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  /** @type {Map<string, { record: object, controller: AbortController | null, dir: string, musicInfo: object, source: string, abortTimer: NodeJS.Timeout | null }>} */
  const tasks = new Map();
  /** @type {string[]} 待下载任务 id，FIFO。 */
  const queue = [];
  let running = 0;

  const getDownloadDir = () => {
    const stored = store.get('downloadDir');
    if (typeof stored === 'string' && stored.trim()) return stored;
    return defaultDir;
  };

  const setDownloadDir = (dir) => {
    if (typeof dir === 'string' && dir.trim()) store.set('downloadDir', dir);
    else store.delete('downloadDir');
    return getDownloadDir();
  };

  const emit = (record) => {
    try {
      onProgress(toPublicTask(record));
    } catch (error) {
      warn('[lx-download] progress callback failed:', error?.message ?? error);
    }
  };

  const emitThrottled = (record) => {
    const now = Date.now();
    if (now - (record.lastEmitAt ?? 0) < PROGRESS_THROTTLE_MS) return;
    record.lastEmitAt = now;
    emit(record);
  };

  const supportedQualitys = (source) => {
    try {
      const qualitys = host.getStatus()?.sources?.[source]?.qualitys;
      return Array.isArray(qualitys) ? qualitys : [];
    } catch {
      return [];
    }
  };

  const finish = (entry) => {
    if (entry.abortTimer) {
      clearTimeout(entry.abortTimer);
      entry.abortTimer = null;
    }
    entry.controller = null;
  };

  // 下载成功后尽力而为地内嵌歌词与封面：任何失败都只是 warn + 记录，绝不影响下载结果。
  const embedTagsInto = async (entry, record, filePath, extension, controller) => {
    if (extension !== 'mp3' && extension !== 'flac') return;
    try {
      const info = { musicInfo: entry.musicInfo };
      const [lyricRaw, coverRaw] = await Promise.all([
        host.request({ source: entry.source, action: 'lyric', info }).catch(() => null),
        host.request({ source: entry.source, action: 'pic', info }).catch(() => null),
      ]);
      const lyric = resolveLyricText(lyricRaw);
      const coverUrl = resolveCoverUrl(coverRaw);

      // pic 返回多为图片 URL，需再抓一次二进制。
      let cover;
      let coverMime = '';
      if (coverUrl) {
        try {
          const response = await doFetch(coverUrl, { redirect: 'follow', signal: controller?.signal });
          if (response?.ok) {
            cover = Buffer.from(await response.arrayBuffer());
            const contentType = response.headers?.get?.('content-type');
            if (contentType) coverMime = String(contentType).split(';')[0].trim();
          }
        } catch (error) {
          warn('[lx-download] 封面下载失败:', error?.message ?? error);
        }
      }

      if (!lyric && !cover) return;
      const result = await embedTags({
        filePath,
        title: record.name,
        artist: record.artist,
        cover,
        mime: coverMime,
        lyric,
      });
      if (result?.ok && result.written) record.tagged = true;
      else if (!result?.ok) record.tagError = result?.reason ?? 'tag-failed';
    } catch (error) {
      warn('[lx-download] 内嵌标签失败:', error?.message ?? error);
      record.tagError = error?.message ?? String(error);
    }
  };

  const runTask = async (taskId) => {
    const entry = tasks.get(taskId);
    if (!entry || entry.record.status !== 'queued') return;
    const { record } = entry;
    try {
      record.status = 'downloading';
      emit(record);

      const resolvedQuality = pickDownloadQuality(record.requestedQuality, supportedQualitys(entry.source));
      record.quality = resolvedQuality;
      // 目标音质不可用时降级，并如实回报（UI 会标注）。
      record.degraded = resolvedQuality !== QUALITY_FOR_PREFERENCE[record.requestedQuality];
      if (record.degraded) emit(record);

      const controller = new AbortController();
      entry.controller = controller;
      entry.abortTimer = setTimeout(() => controller.abort(), TASK_TIMEOUT_MS);

      // 直链由宿主窗口里的用户脚本解析；结果形状与 lx-source:get-music-url 一致。
      const rawResult = await host.request({
        source: entry.source,
        action: 'musicUrl',
        info: { type: resolvedQuality, musicInfo: entry.musicInfo },
      });
      const resolved = rawResult?.data ?? rawResult;
      const url = typeof resolved?.url === 'string' ? resolved.url : '';
      if (!url) throw new Error('音源未返回播放地址');

      await fs.promises.mkdir(entry.dir, { recursive: true });
      // 临时名带 taskId，避免同名并发互相覆盖；完成后才 rename 成最终名。
      const tempPath = path.join(entry.dir, `${taskId}.part`);
      const extension = extensionForQuality(resolvedQuality, url);

      const response = await doFetch(url, { redirect: 'follow', signal: controller.signal });
      if (!response?.ok || !response.body) throw new Error(`下载失败：HTTP ${response?.status ?? '未知'}`);
      const declaredSize = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > 0) record.totalBytes = declaredSize;

      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          record.receivedBytes += chunk.length;
          record.progress = record.totalBytes > 0
            ? Math.min(1, record.receivedBytes / record.totalBytes)
            : 0;
          emitThrottled(record);
          callback(null, chunk);
        },
      });

      let finalPath = null;
      try {
        await pipeline(
          Readable.fromWeb(response.body),
          counter,
          fs.createWriteStream(tempPath),
          { signal: controller.signal },
        );
        finalPath = uniquePath(entry.dir, buildDownloadFileName(record.artist, record.name, extension));
        await fs.promises.rename(tempPath, finalPath);
        record.filePath = finalPath;
      } catch (error) {
        await fs.promises.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }

      // 落盘成功后内嵌标签：失败仅记录，不改任务成功状态。
      await embedTagsInto(entry, record, finalPath, extension, controller);

      record.status = 'done';
      record.progress = 1;
      if (record.totalBytes > 0) record.receivedBytes = record.totalBytes;
      emit(record);
    } catch (error) {
      if (record.status === 'canceled') {
        emit(record);
        return;
      }
      record.status = 'error';
      record.error = error?.name === 'AbortError' ? '下载超时或已取消' : (error?.message ?? String(error));
      emit(record);
    } finally {
      finish(entry);
    }
  };

  const pump = () => {
    while (running < MAX_CONCURRENT) {
      const taskId = queue.shift();
      if (taskId === undefined) return;
      const entry = tasks.get(taskId);
      if (!entry || entry.record.status !== 'queued') continue;
      running += 1;
      void runTask(taskId).finally(() => {
        running -= 1;
        pump();
      });
    }
  };

  /** 入队一个下载任务；返回任务快照。 */
  const start = ({ track, quality, targetDir } = {}) => {
    const source = text(track?.source);
    const musicInfo = track?.musicInfo && typeof track.musicInfo === 'object' ? track.musicInfo : null;
    if (!source || !musicInfo) throw new Error('缺少下载所需的歌曲信息');
    const requestedQuality = QUALITY_FOR_PREFERENCE[quality] ? quality : 'standard';
    const taskId = `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      taskId,
      name: text(track?.name) || '未知歌曲',
      artist: text(track?.artist) || '未知歌手',
      status: 'queued',
      quality: null,
      requestedQuality,
      degraded: false,
      receivedBytes: 0,
      totalBytes: 0,
      progress: 0,
      error: null,
      filePath: null,
      tagged: false,
      tagError: null,
      createdAt: Date.now(),
      lastEmitAt: 0,
    };
    tasks.set(taskId, {
      record,
      controller: null,
      abortTimer: null,
      dir: typeof targetDir === 'string' && targetDir.trim() ? targetDir : getDownloadDir(),
      musicInfo,
      source,
    });
    queue.push(taskId);
    emit(record);
    pump();
    return toPublicTask(record);
  };

  /** 取消：排队中的直接出队，下载中的中断流（临时文件由 runTask 清理）。 */
  const cancel = (taskId) => {
    const entry = tasks.get(taskId);
    if (!entry) return false;
    const { record } = entry;
    if (record.status === 'queued') {
      const index = queue.indexOf(taskId);
      if (index >= 0) queue.splice(index, 1);
      record.status = 'canceled';
      emit(record);
      return true;
    }
    if (record.status === 'downloading') {
      record.status = 'canceled';
      entry.controller?.abort();
      emit(record);
      return true;
    }
    return false;
  };

  /**
   * 删除一条下载记录。只允许删除已结束（完成 / 失败 / 取消）的任务：活动中的任务得先取消，
   * 否则留下一条既不在队列里、又还被引用的幽灵记录。只移除记录，不动已落盘的文件。
   */
  const remove = (taskId) => {
    const entry = tasks.get(taskId);
    if (!entry) return false;
    if (entry.record.status === 'queued' || entry.record.status === 'downloading') return false;
    return tasks.delete(taskId);
  };

  /** 按创建时间倒序返回全部任务（最新在前）。 */
  const list = () => Array.from(tasks.values())
    .map(entry => toPublicTask(entry.record))
    .sort((a, b) => b.createdAt - a.createdAt);

  /** 退出时中断所有下载，避免残留的半截文件。 */
  const shutdown = () => {
    for (const entry of tasks.values()) {
      if (entry.record.status === 'queued' || entry.record.status === 'downloading') {
        entry.record.status = 'canceled';
        entry.controller?.abort();
      }
    }
  };

  return { getDownloadDir, setDownloadDir, start, cancel, remove, list, shutdown };
}

module.exports = {
  createLxDownload,
  sanitizeFileName,
  buildDownloadFileName,
  pickDownloadQuality,
  extensionForQuality,
};
