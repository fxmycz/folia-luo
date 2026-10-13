// electron/lxSource/lxSourceIpc.cjs
// 自定义音源版块的主进程入口：创建仓储与宿主，注册渲染层要用的 `lx-source:*` handler。
// 返回统一 `{ ok: true, data } | { ok: false, error: { code, message } }`，与 bodian / kugou 的桥一致。
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const Store = require('electron-store').default || require('electron-store');
const { createLxSourceStore } = require('./lxSourceStore.cjs');
const { createLxSourceHost } = require('./lxSourceHost.cjs');
const { createLxDownload } = require('./lxDownload.cjs');
const { encodeLxPlaylistFile, decodeLxPlaylistFile } = require('./lxPlaylistCodec.cjs');
const musicSdk = require('./musicSdk/index.cjs');

// 与 renderer 侧 OnlineProviderError 的错误码词汇保持一致。
const ok = (data) => ({ ok: true, data });
const fail = (code, message) => ({ ok: false, error: { code, message } });

// 导入脚本时限制体积（在线链接与本地文件共用），避免把超大文件塞进 electron-store。
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;

// 收藏列表文件（.lxmc）体积极限：列表文本，给 16MB 足够，防止误选巨型文件。
const MAX_PLAYLIST_BYTES = 16 * 1024 * 1024;

// 导出文件名里的非法字符换成下划线，避免写入失败（Windows 保留字符）。
const sanitizeFileName = (name) => {
  const cleaned = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned || 'lx_list';
};

// 下载目录默认值：系统音乐目录下的 Folia 子目录；逐个回退到下载目录 / 主目录，永不抛错。
const defaultDownloadDir = () => {
  for (const name of ['music', 'downloads', 'home']) {
    try {
      return path.join(app.getPath(name), 'Folia');
    } catch {
      // 该路径名不可用，试下一个。
    }
  }
  return path.join(process.cwd(), 'Folia');
};

const fetchScriptText = async (url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('请输入 http(s) 开头的音源地址');
  }
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`下载音源失败：HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_SCRIPT_BYTES) throw new Error('音源脚本过大，已中止导入');
  return text;
};

/**
 * 注册自定义音源版块的 IPC。
 * @param {object} options
 * @param {Electron.IpcMain} options.ipcMain
 * @param {(webContents: Electron.WebContents) => boolean} options.isTrusted 仅接受主窗口发来的请求
 * @param {string} [options.userAgent] 在线导入脚本时使用的 UA
 */
function registerLxSourceIpc({ ipcMain, isTrusted, warn = console.warn }) {
  const store = createLxSourceStore();

  const broadcast = (channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };

  const host = createLxSourceHost({
    ipcMain,
    store,
    warn,
    onStatusChange: (status) => broadcast('lx-source:status-changed', status),
    onUpdateAlert: (alert) => broadcast('lx-source:update-alert', alert),
  });

  // Phase 3：下载队列。与音源仓储共用同一个 electron-store 命名空间 `lx-source`，只占 `downloadDir` 键。
  const download = createLxDownload({
    host,
    store: new Store({ name: 'lx-source' }),
    defaultDir: defaultDownloadDir(),
    onProgress: (task) => broadcast('lx-source:download-progress', task),
    warn,
  });

  // 一次性快照：列表 + 激活源 + 宿主状态，避免渲染层连续 invoke 三次。
  const snapshot = () => ({
    apis: store.getUserApis(),
    activeApiId: store.getActiveApiId(),
    status: host.getStatus(),
  });

  const guard = (handler) => async (event, ...args) => {
    if (!isTrusted(event.sender)) return fail('unavailable', '未授权的音源请求');
    try {
      return ok(await handler(...args));
    } catch (error) {
      return fail('invalid-response', error?.message ?? String(error));
    }
  };

  ipcMain.handle('lx-source:list-apis', guard(() => snapshot()));

  ipcMain.handle('lx-source:import-online', guard(async (url) => {
    const text = await fetchScriptText(url);
    await store.importApi(text);
    return snapshot();
  }));

  ipcMain.handle('lx-source:import-text', guard(async (text) => {
    await store.importApi(text);
    return snapshot();
  }));

  // 本地文件导入：弹系统文件选择框挑一个 .js 音源脚本，读为 UTF-8 后落盘。
  // 用户取消时不算失败，返回 `{ canceled: true, snapshot }` 让渲染层保持原状。
  ipcMain.handle('lx-source:import-file', async (event) => {
    if (!isTrusted(event.sender)) return fail('unavailable', '未授权的音源请求');
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: '选择音源脚本',
        // 记住上一次选中的文件，下次弹框直接定位过去。
        defaultPath: store.getLastFilePath('script'),
        properties: ['openFile'],
        filters: [
          { name: '音源脚本', extensions: ['js'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return ok({ canceled: true, snapshot: snapshot() });
      }
      const filePath = result.filePaths[0];
      store.setLastFilePath('script', filePath);
      const { size } = await fs.promises.stat(filePath);
      if (size > MAX_SCRIPT_BYTES) throw new Error('音源脚本过大，已中止导入');
      const text = await fs.promises.readFile(filePath, 'utf8');
      await store.importApi(text);
      return ok({ canceled: false, snapshot: snapshot() });
    } catch (error) {
      return fail('invalid-response', error?.message ?? String(error));
    }
  });

  // 收藏列表导出：渲染层把列表序列化成洛雪 `.lxmc` 文本后传进来，这里只负责弹保存框并落盘。
  // 取消返回 `{ canceled: true }`，由渲染层保持原状。
  ipcMain.handle('lx-source:export-playlist', async (event, payload = {}) => {
    if (!isTrusted(event.sender)) return fail('unavailable', '未授权的音源请求');
    try {
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!text) throw new Error('导出的列表内容为空');
      if (Buffer.byteLength(text, 'utf8') > MAX_PLAYLIST_BYTES) throw new Error('列表文件过大，已中止导出');
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: '导出收藏列表',
        defaultPath: `lx_list_part_${sanitizeFileName(payload.name)}.lxmc`,
        filters: [
          { name: '洛雪列表文件', extensions: ['lxmc'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      };
      const result = parentWindow
        ? await dialog.showSaveDialog(parentWindow, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return ok({ canceled: true, filePath: null });
      // 洛雪导出的 `.lxmc` 是 gzip 压缩的 JSON，这里写成同种格式，洛雪才能直接读回。
      await fs.promises.writeFile(result.filePath, encodeLxPlaylistFile(text));
      return ok({ canceled: false, filePath: result.filePath });
    } catch (error) {
      return fail('invalid-response', error?.message ?? String(error));
    }
  });

  // 收藏列表导入：弹文件选择框读 `.lxmc` / `.json` 文本原样返回，解析留在渲染层（复用 normalizeLxSong）。
  ipcMain.handle('lx-source:import-playlist', async (event) => {
    if (!isTrusted(event.sender)) return fail('unavailable', '未授权的音源请求');
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: '导入收藏列表',
        // 记住上一次选中的文件，下次弹框直接定位过去。
        defaultPath: store.getLastFilePath('playlist'),
        properties: ['openFile'],
        filters: [
          { name: '洛雪列表文件', extensions: ['lxmc', 'json'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return ok({ canceled: true, name: '', text: '' });
      }
      const filePath = result.filePaths[0];
      store.setLastFilePath('playlist', filePath);
      const { size } = await fs.promises.stat(filePath);
      if (size > MAX_PLAYLIST_BYTES) throw new Error('列表文件过大，已中止导入');
      // 洛雪的 `.lxmc` 是 gzip 压缩的 JSON；也兼容未压缩的纯 JSON 文本。
      const text = decodeLxPlaylistFile(await fs.promises.readFile(filePath));
      if (Buffer.byteLength(text, 'utf8') > MAX_PLAYLIST_BYTES) throw new Error('列表文件过大，已中止导入');
      return ok({ canceled: false, name: path.basename(filePath), text });
    } catch (error) {
      return fail('invalid-response', error?.message ?? String(error));
    }
  });

  ipcMain.handle('lx-source:remove-apis', guard(async (ids) => {
    const activeId = store.getActiveApiId();
    store.removeApis(ids);
    // 删掉的是当前激活源：宿主一并卸载，避免继续跑已删除的脚本。
    if (Array.isArray(ids) && activeId && ids.includes(activeId)) await host.unload();
    return snapshot();
  }));

  ipcMain.handle('lx-source:set-active', guard(async (apiId) => {
    if (apiId) {
      store.setActiveApiId(apiId);
      await host.load(apiId);
    } else {
      store.setActiveApiId(null);
      await host.unload();
    }
    return snapshot();
  }));

  ipcMain.handle('lx-source:get-status', guard(() => snapshot()));

  // quality 由渲染层按音源声明的音质集合解析好之后传入。
  const requestFromScript = async ({ source, action, info }) => {
    const result = await host.request({ source, action, info });
    return result?.data ?? result;
  };

  const resolveByAction = (action) => guard(async (payload = {}) => {
    const { source, musicInfo, quality } = payload;
    if (!source) throw new Error('缺少平台标识');
    const info = action === 'musicUrl' ? { type: quality, musicInfo } : { musicInfo };
    return requestFromScript({ source, action, info });
  });

  ipcMain.handle('lx-source:get-music-url', resolveByAction('musicUrl'));
  ipcMain.handle('lx-source:get-pic', resolveByAction('pic'));

  // 歌词：先问用户音源脚本，脚本没实现 lyric（或返回空）时回退到移植的洛雪内置歌词。
  // 洛雪里歌词本就由内置 musicSdk 提供、自定义音源脚本只负责直链，故这里补上同源兜底，
  // 否则只声明 musicUrl 的音源在本软件会没有歌词（在洛雪却正常）。
  ipcMain.handle('lx-source:get-lyric', guard(async (payload = {}) => {
    const { source, musicInfo } = payload;
    if (!source) throw new Error('缺少平台标识');
    let scriptError = null;
    try {
      const data = await requestFromScript({ source, action: 'lyric', info: { musicInfo } });
      if (typeof data?.lyric === 'string' && data.lyric) return data;
    } catch (error) {
      scriptError = error;
    }
    try {
      return await musicSdk.getLyric(source, musicInfo);
    } catch (error) {
      // 两者都拿不到时，优先抛出脚本的错误（更贴近「该音源没实现歌词」这一现象）。
      throw scriptError || error;
    }
  }));

  // Phase 2：平台榜单 / 歌单 / 搜索数据来自移植的洛雪 musicSdk（仅 kw / mg）。
  // 返回洛雪原始记录（source/songmid/singer/interval/…），归一化交给渲染层的 lxNormalize。
  ipcMain.handle('lx-source:get-boards', guard((source) => musicSdk.getBoards(source)));
  ipcMain.handle('lx-source:get-board-tracks', guard((payload) => musicSdk.getBoardTracks(payload)));
  ipcMain.handle('lx-source:get-playlist-tracks', guard((payload) => musicSdk.getPlaylistTracks(payload)));
  ipcMain.handle('lx-source:search-songs', guard((payload) => musicSdk.searchSongs(payload)));
  ipcMain.handle('lx-source:search-playlists', guard((payload) => musicSdk.searchPlaylists(payload)));
  // 搜索联想：平台不支持 / 请求失败时返回空数组，渲染层据此回退到本地搜索历史。
  ipcMain.handle('lx-source:search-suggestions', guard((payload) => musicSdk.searchSuggestions(payload)));

  // Phase 3：下载。目录选择需要拿到发起请求的窗口作为 dialog 的父窗口，故单独处理。
  ipcMain.handle('lx-source:choose-download-dir', async (event) => {
    if (!isTrusted(event.sender)) return fail('unavailable', '未授权的音源请求');
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const currentDir = download.getDownloadDir();
      const options = {
        title: '选择下载目录',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: currentDir,
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return ok({ canceled: true, dir: currentDir });
      }
      return ok({ canceled: false, dir: download.setDownloadDir(result.filePaths[0]) });
    } catch (error) {
      return fail('invalid-response', error?.message ?? String(error));
    }
  });

  ipcMain.handle('lx-source:start-download', guard((payload) => download.start(payload)));
  ipcMain.handle('lx-source:cancel-download', guard((taskId) => download.cancel(taskId)));
  ipcMain.handle('lx-source:remove-download', guard((taskId) => download.remove(taskId)));
  ipcMain.handle('lx-source:list-downloads', guard(() => ({
    dir: download.getDownloadDir(),
    tasks: download.list(),
  })));

  ipcMain.handle('lx-source:open-devtools', guard(() => {
    host.openDevTools();
    return true;
  }));

  host.init();

  // 启动时恢复上次激活的音源；失败不阻塞启动，只更新状态。
  const activeId = store.getActiveApiId();
  if (activeId) {
    host.load(activeId).catch((error) => {
      warn('[lx-source] failed to restore active source:', error?.message ?? error);
    });
  }

  return { store, host, download, snapshot };
}

module.exports = { registerLxSourceIpc };
