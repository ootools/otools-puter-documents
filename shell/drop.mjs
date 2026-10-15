/**
 * 从构建树里删掉的路径：只服务 Puter 云 / 在线协作 / 需要登录的功能。
 * ------------------------------------------------------------------
 * 删完之后的 `keep` 是断言：这些文件必须还在，否则说明删过头了
 * （上游改了路径、或者 drop 列表写宽了）。
 */
export const drops = [
  // 协作房间的**服务端**：一个跑在 Puter worker 上的房间服务（鉴权、房间表、
  // 快照存储全靠 puter.kv / puter.fs）。客户端 `src/collab/api.js` 在部署它，
  // 而部署要 Puter 账号（`puter.authToken`、`puter.workers.create`）。
  // 插件里没有任何东西 import 它（它是给上游的 dev/collab-dev-server.mjs 与
  // 部署脚本用的），整块拿掉。
  'src/collab/server',
];

export const keep = [
  'index.html',
  'src/main.js',
  'src/lib/puter.js',
  'src/lib/doc.js',
  'src/lib/session.js',
  'src/styles/index.css',
  // 协作的**客户端**协议与入口还在：`src/main.js` 用 protocol.js 解析邀请链接，
  // `src/views/collab.js` 用 protocol.js 画角色标签。删了 server 之后它们必须还在。
  'src/collab/protocol.js',
  'src/collab/live.js',
  'src/views/editor.js',
  'src/views/collab.js',
];
