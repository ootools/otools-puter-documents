/**
 * 逐条外科手术式改动（1~5 行的局部修改）。
 * ------------------------------------------------------------------
 * 每一条都必须能命中：`expect` 是硬约束。上游改了那段代码，构建会报
 * 「命中 N 次，期望 M 次」并打印是哪一条、为什么改。**不要为了让构建过而
 * 放宽 expect**，要去读上游的新代码，把 find/replace 更新到新的形状。
 *
 * 超过 5 行、或者涉及结构性改动，就别放这里——走 shell/overlay/ 整文件替换
 * （本项目的 `src/lib/puter.js` 就是这么换掉的）。
 *
 * 这批改动的主题只有一个：**摘掉需要 Puter 登录的入口**。
 * 文件本身已经在 seam 里改成走本机磁盘了（见 shell/overlay/src/lib/puter.js），
 * 这里处理的是那些「要 Puter 账号 / 云端房间 / 云端 AI 才成立」的界面入口：
 * 登录登出、实时协作的分享与自动重连、云端邀请链接。能在本机成立的
 * （打开本机文件、另存、导出 .docx / PDF）一律保留。
 *
 * 注意：不要把注释写进 `replace`（行尾 `//` 会把同一行后面的代码一起注释掉），
 * 说明一律写进 `why`。
 */
export const edits = [
  {
    file: 'src/ui/appmenu.js',
    find: `    items.push({ separator: true });
    if (session.signedOut) items.push({ label: 'Sign in to Puter', icon: 'login', hint: 'Save documents to your own cloud', onSelect: () => session.signIn() });
    else items.push({ label: 'Sign out', icon: 'logout', onSelect: confirmSignOut });
`,
    replace: '',
    expect: 1,
    why: '账号菜单里的「Sign in to Puter / Sign out」两项（连同它们上面的分隔线）：插件里没有 Puter 账号，本地文件模型下也没有「登出」这回事。`P.isApp()` 恒为 true 本来就会跳过这一支，这里显式删掉，免得以后 env 的语义变了又把登录入口放回来。',
  },
  {
    file: 'src/ui/appmenu.js',
    find: `'A private word processor with an original canvas editor. Files are saved as .docx in your own Puter cloud.'`,
    replace: `'A private word processor with an original canvas editor. Files are saved as .docx on this computer.'`,
    expect: 1,
    why: '「关于 Documents」里的存放说明：文件现在落在本机库目录，不再是 Puter 云盘。',
  },
  {
    file: 'src/views/editor.js',
    find: `    shareAvailable: () => true,`,
    replace: `    shareAvailable: () => false,`,
    expect: 1,
    why: '后台（File 视图）左侧的 Share 页：整页只有「Share with people」（云端协作房间）和「Publish to the web」（puter.site 托管）两件事，都要 Puter 账号。关掉开关，这一页不再出现（Export / Save / Print 等本机可用的页保留）。',
  },
  {
    file: 'src/views/editor.js',
    find: `  editorCommands.shareItems = () => [...collab.shareItems(), ...(collabShareItems?.() || [{ label: 'Download a Copy (.docx)', icon: 'download', disabled: !engine || failed, onSelect: download }])];`,
    replace: `  editorCommands.shareItems = () => [...(collabShareItems?.() || [{ label: 'Download a Copy (.docx)', icon: 'download', disabled: !engine || failed, onSelect: download }])];`,
    expect: 1,
    why: '标题栏 Share 菜单：去掉 collab 加进来的「Invite People… / Copy Link / Manage Access…」——它们要云端房间。保留上游自己的「Send a Copy (.docx) / Send as PDF」（落到本机文件，可用）；其中「Publish to the Web…」由 `P.canHost()` 恒为 false 自动消失。',
  },
  {
    file: 'src/views/editor.js',
    find: `      : doc.path ? ['Saved to Puter', 'cloud', 'saved'] : ['Not saved yet', 'cloud', 'unsaved'];`,
    replace: `      : doc.path ? ['Saved', 'cloud', 'saved'] : ['Not saved yet', 'cloud', 'unsaved'];`,
    expect: 1,
    why: '状态栏的保存位置提示：文件存的是本机磁盘，不是 Puter。',
  },
  {
    file: 'src/views/collab.js',
    find: `    if (id === 'tools') return [{ separator: true }, { label: 'Share…', icon: 'share', disabled: !editor(), onSelect: share }, ...(live ? [{ label: 'Co-authors', icon: 'coauthors', items: people().map(p => ({ label: \`\${p.name}\${p.me ? ' (you)' : ''}\`, hint: roleLabel(p.role || 'editor'), disabled: p.me, onSelect: () => live?.follow(p.session) })) }] : [])];`,
    replace: `    return [];`,
    expect: 1,
    why: 'Tools 菜单里的「Share…」与「Co-authors」：前者开云端协作房间，后者列出房间里的人，都要 Puter 账号与云端 worker，去掉。',
  },
  {
    file: 'src/views/collab.js',
    find: `      if (!local && doc.path && !readOnly()) {`,
    replace: `      if (local && doc.path && !readOnly()) {`,
    expect: 1,
    why: '打开文档后自动重连云端协作房间（`reconnect`）：它要 Puter 账号并把文档路径发给云端 worker，失败会在每次打开文档时弹一条错误提示。插件只用本机文件，这一支关掉；`local`（同一浏览器多标签，走 BroadcastChannel，不需要 Puter）的那支保留。',
  },
  {
    file: 'src/views/collab.js',
    find: `  function ensureShared(progress = () => {}) {
    if (live) return Promise.resolve(live);
`,
    replace: `  function ensureShared(progress = () => {}) {
    throw new Error('Sharing needs a Puter account. This build keeps documents on this computer.');
`,
    expect: 1,
    why: '分享的真正入口（建房间 / 部署 worker）：界面上的按钮已经摘掉了，这里是兜底——万一有命令或快捷键还能走到它，给一句明确的「不可用」而不是去打云端接口。',
  },
  {
    file: 'src/main.js',
    find: `  if (!link.local && session.signedOut) { mountSignInGate(requestedHash, 'shared document'); return; }`,
    replace: `  if (!link.local) { toast('Shared documents need a Puter account, which this build does not use.', { icon: 'alert', duration: 8000 }); go(HOME); return; }`,
    expect: 1,
    why: '邀请链接（#collab-…）加入云端房间：要 Puter 账号登录房间服务器。插件里直接拒绝并回到文档列表，不再弹「Sign in to open this shared document」的登录门（`session.signedOut` 恒为 false，那个分支本来也进不去）。',
  },
  {
    file: 'src/views/home.js',
    find: `'Open from Puter'`,
    replace: `'Open from this device'`,
    expect: 1,
    why: '首页的「Open from Puter」按钮：它现在弹的是宿主的打开对话框、读的是本机文件，按钮文案不再提 Puter。',
  },
  {
    file: 'src/views/home.js',
    find: `    el('footer.home-foot', {}, 'Saved as .docx in your Puter cloud under ', el('code', {}, \`\${P.FOLDER}/\`)));`,
    replace: `    el('footer.home-foot', {}, 'Saved as .docx on this computer under ', el('code', {}, \`\${P.FOLDER}/\`)));`,
    expect: 1,
    why: '首页底部的存放说明：改成「存在这台电脑上」。后面的 `Documents/` 是本机库目录名，保持不动。',
  },
];
