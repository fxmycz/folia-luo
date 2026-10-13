// electron/lxSource/lxSourceChannels.cjs
// 自定义音源宿主相关的两组名字，主进程、宿主窗口 preload 和 IPC 注册处三边共用，避免各写一遍后漂移。
//
// - LX_SOURCE_EVENT_NAMES：暴露给用户脚本的公开事件名（`lx.EVENT_NAMES`），必须与洛雪一致，
//   脚本写死了 `lx.send(lx.EVENT_NAMES.inited, ...)` / `lx.on(lx.EVENT_NAMES.request, ...)`。
// - LX_SOURCE_CHANNELS：宿主窗口 preload 与主进程之间的 IPC 通道名，带 `lx-source:` 前缀。
//
// 对应洛雪 lx-music-desktop 的 userApi/rendererEvent/name.js（Apache-2.0）。
const LX_SOURCE_EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
};

const LX_SOURCE_CHANNELS = {
  init: 'lx-source:init',
  initEnv: 'lx-source:init-env',
  request: 'lx-source:request',
  response: 'lx-source:response',
  openDevTools: 'lx-source:open-devtools',
  showUpdateAlert: 'lx-source:show-update-alert',
  proxyUpdate: 'lx-source:proxy-update',
};

module.exports = { LX_SOURCE_EVENT_NAMES, LX_SOURCE_CHANNELS };
