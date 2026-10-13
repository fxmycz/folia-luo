// electron/lxSource/lxSourceHtml.cjs
// 自定义音源宿主窗口加载的空白页。CSP 锁死一切外部资源：脚本能做的网络请求只能走 preload 注入的
// `lx.request`（在主进程侧），页面本身没有任何可直接发起外联的入口。
// 对应洛雪 lx-music-desktop 的 userApi/renderer/user-api.html（Apache-2.0）。
const LX_SOURCE_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '  <title>Folia LX Source</title>',
  '</head>',
  '<body>',
  '</body>',
  '</html>',
].join('\n');

module.exports = { LX_SOURCE_HTML };
