/**
 * Everything the app asks of Puter, in one place — answered by this computer.
 * ------------------------------------------------------------------
 * 这是整个移植的 seam：上游把「应用向 Puter 要的一切」收敛在这一个模块里
 * （`auth` / `env` / `files` / `pickers`），其余代码只 import 它。所以换掉
 * 这一个文件，整个应用就从「存到 Puter 云盘」变成「存到本机磁盘」。
 *
 * 导出清单与上游**逐条一致**（其余代码按名字 import，签名不能变）：
 * 常量、名称处理、文件读写、目录列举、打开/另存对话框、AI、托管、桌面集成。
 *
 * 三条退路（见 shell/src/otools/local.js）：
 *   1. 宿主磁盘（OTools 里）：真·本地读写 + 系统打开/另存对话框；
 *   2. 浏览器下载 / `<input type=file>`；
 *   3. OPFS（连下载都不方便时的最后退路）。
 *
 * 关于 Puter 登录：
 *   `isSignedIn()` 恒为 true（「已登录到这台机器」）、`signIn()`/`signOut()`
 *   是空操作、`getUser()` 给一个本地身份。真正要 Puter 账号的能力（实时协作、
 *   云端 AI、发布到 puter.site、云端 KV）在下面一律报「不可用」，界面上的入口
 *   由 `shell/edits.mjs` 摘掉 —— 不在这里假装它们能用。
 *
 * 路径约定照抄上游：文档仍是 `Documents/<name>.docx`。这里把它当成**虚拟前缀**，
 * 解析到本机库目录（`libraryDir()`，通常是 `~/Documents/Documents`）。
 * 之所以保留前缀而不直接换成绝对路径，是因为上游到处用这个形状做判断
 * （`displayName` 取最后一段、`versionsFolder` 认 `Documents/` 前缀、
 * `doc.js` 用 `P.FOLDER` 拼新文件的位置）。真·本机路径（用户用打开对话框
 * 选的、宿主从「打开方式」传进来的）原样透传，两边都能用。
 */

import * as host from '../otools/host.js';
import {
  dedupeName, downloadBlob as browserDownload, exportFile, importFiles, libraryDir,
  listLibrary, localAuth, localUser, opfsList, opfsRead, opfsRemove, opfsWrite,
  readPath, usingHost, writeToPath,
} from '../otools/local.js';

export const FOLDER = 'Documents';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const OPENABLE = /\.(docx|dotx|docm|hwp|hwpx)$/i;
export const DOCUMENT_EXTENSIONS = ['.docx', '.dotx', '.docm', '.hwp', '.hwpx'];
/** Device imports: DOCX, Hanword, and the text formats the engine reads. */
export const IMPORTABLE = /\.(docx|dotx|docm|hwp|hwpx|md|markdown|txt|html?)$/i;
export const IMPORT_ACCEPT = '.docx,.dotx,.docm,.hwp,.hwpx,.md,.markdown,.txt,.html,.htm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/x-hwp,application/haansofthwp,application/vnd.hancom.hwp,application/hwp+zip,text/markdown,text/plain,text/html';
/** Image types the engine places on the page, with their MIME types. */
export const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
export const IMAGE_EXTENSIONS = Object.keys(IMAGE_TYPES);

/** The MIME type for a file name by its extension, or '' when unknown. */
export function mimeFor(name) {
  const m = /\.[^./\\]+$/.exec(String(name || ''));
  if (m && /\.hwp$/i.test(m[0])) return 'application/x-hwp';
  if (m && /\.hwpx$/i.test(m[0])) return 'application/hwp+zip';
  return (m && IMAGE_TYPES[m[0].toLowerCase()]) || (m && OPENABLE.test(m[0]) ? DOCX_MIME : '');
}

/* ------------------------------------------------------------------ 路径 */

const PREFIX = `${FOLDER}/`;

/** 库目录（本机）。宿主不在时为空串，调用方按「没有落点」处理。 */
async function root() {
  try {
    return (await libraryDir()) || '';
  } catch {
    return '';
  }
}

const isVirtual = (path) => {
  const p = String(path || '');
  return p === FOLDER || p.startsWith(PREFIX);
};

/**
 * 虚拟的 `Documents/…` 落到本机库目录里的真实路径；真·本机路径原样返回。
 *
 * 刻意用 `/` 而不是 `host.joinPath`：上游所有路径判断（displayName、
 * dirname、版本目录）都按 `/` 切分，Windows 上宿主给的 `\` 会被 listDir /
 * dirName 正确识别，但拼进虚拟路径会破坏上游的判断。
 */
async function realPath(path) {
  const p = String(path || '').trim();
  if (!p || !isVirtual(p)) return p;
  const base = await root();
  if (!base) return p;
  const tail = p.slice(FOLDER.length).replace(/^\/+/, '');
  return tail ? `${base.replace(/\/+$/, '')}/${tail}` : base;
}

/** 反向：真实路径 → 虚拟路径（能放进库目录的才换，其余原样）。 */
async function virtualPath(path) {
  const p = String(path || '');
  const base = await root();
  if (!base || !p.startsWith(`${base}/`)) return p;
  return `${PREFIX}${p.slice(base.length + 1)}`;
}

/* ------------------------------------------------------------ OPFS 兜底 */

// OPFS 的文件名不能含 `/`：按段编码再用 `~` 连起来，既能还原也能做前缀匹配。
const opfsKey = (path) => String(path || '').split('/').map(encodeURIComponent).join('~');
const opfsKeyOf = (name) => { try { return decodeURIComponent(String(name).split('~').join('/')); } catch { return ''; } };

/** OPFS 里落在 `dir/` 下的条目（宿主不在时的目录列举）。 */
async function opfsEntriesUnder(dir) {
  const prefix = `${String(dir).replace(/\/+$/, '')}/`;
  const out = [];
  for (const entry of await opfsList()) {
    const path = opfsKeyOf(entry.name);
    if (!path.startsWith(prefix)) continue;
    const file = await opfsRead(entry.name);
    out.push({ name: host.baseName(path), path, size: file?.size || 0, modified: file?.lastModified || 0, isDir: false });
  }
  return out;
}

/* -------------------------------------------------------------- 基础读写 */

function missingError(path) {
  return Object.assign(new Error(`No such file or directory: ${path}`), { code: 'ENOENT' });
}

/** 一个路径的元数据（没有就是 null）。 */
async function statEntry(path) {
  const target = await realPath(path);
  if (!target) return null;
  if (usingHost()) {
    const parent = host.dirName(target);
    if (!parent) return null;
    const entries = await host.listDir(parent);
    const found = entries.find((e) => e.name === host.baseName(target));
    if (!found) return null;
    return { path: found.path || target, name: found.name, size: found.size || 0, modified: found.modified || 0, isDir: !!found.isDir, is_dir: !!found.isDir };
  }
  const file = await opfsRead(opfsKey(target));
  return file ? { path: target, name: host.baseName(target), size: file.size, modified: file.lastModified || 0, isDir: false, is_dir: false } : null;
}

/* --------------------------------------------------------------- env/auth */

export async function prepareDocumentPaths() {
  // 本地文件没有「相对路径 vs 绝对路径」两套写法要对齐，这里无事可做。
}

export function hasSDK() {
  return true;
}

/** 插件总是跑在宿主的应用窗口里：让上游走 `isApp()` 的分支。 */
export function env() {
  return 'app';
}

export function isApp() {
  return env() === 'app';
}

/* ---------- Auth ---------- */

/** 「已登录到这台机器」：本地文件模型下没有会话可问。 */
export async function isSignedIn() {
  return localAuth.isSignedIn();
}

export async function signIn() {
  return localAuth.signIn();
}

export function signOut() {
  return localAuth.signOut();
}

export async function getUser() {
  return localUser();
}

/** 本机身份没有头像（也刻意不发任何远程请求）。 */
export async function getProfilePicture() {
  return null;
}

/** 没有云会话会自己变化的登录，这个通知不会发生。 */
export function onAuth(handler) {
  void handler;
}

/* ---------- Names ---------- */

export function isNotFound(err) {
  const code = err?.code || err?.error?.code || '';
  const msg = String(err?.message || err?.error?.message || err || '').toLowerCase();
  return code === 'subject_does_not_exist' || code === 'ENOENT' || msg.includes('not found') || msg.includes('does not exist') || msg.includes('no such');
}

export function displayName(path) {
  return String(path || '').split('/').pop();
}

export function stripExtension(name) {
  return String(name || '').replace(/\.[^./\\]+$/, '');
}

/** The document name a typed file name stands for: the extension off, then made safe (dots alone are no name). */
export function documentStem(name) {
  return sanitizeName(String(name || '').replace(/\.docx$/i, ''));
}

export function sanitizeName(name) {
  // Trim again after cutting to length: a space at the cut would end the name.
  // A cut through an emoji would leave half of it, which no URL can carry.
  const clean = String(name || '').replace(/[/\\]/g, ' ').replace(/[\x00-\x1f\x7f\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '').trim().slice(0, 200).replace(/[\ud800-\udbff]$/, '').trim();
  // Dots alone name no file: "..docx" would show as "." and its version history could not follow it.
  return /^\.+$/.test(clean) ? '' : clean;
}

export function ensureDocx(name) {
  const clean = sanitizeName(name);
  return /\.docx$/i.test(clean) ? clean : `${clean}.docx`;
}

/* ---------- Files ---------- */

/** Document files in the library folder, newest first. */
export async function listFiles() {
  let items = [];
  try {
    if (usingHost()) {
      const entries = await listLibrary();
      items = entries.map((it) => ({ name: it.name, path: it.path || `${FOLDER}/${it.name}`, size: it.size ?? 0, modified: it.modified ?? 0, isDir: !!it.isDir }));
    } else {
      items = await opfsEntriesUnder(await realPath(FOLDER));
    }
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
  await prepareDocumentPaths();
  return items
    .filter((it) => !it.isDir && !it.is_dir && OPENABLE.test(it.name))
    .map((it) => ({
      name: it.name,
      // 用虚拟路径（与上游一致）：版本目录、文档列表的后续判断都认这个形状。
      path: isVirtual(it.path) ? it.path : `${FOLDER}/${it.name}`,
      size: it.size ?? 0,
      modified: it.modified ?? 0,
      uid: it.uid || it.id || null,
    }))
    .sort((a, b) => (b.modified || 0) - (a.modified || 0));
}

/** Read a file as a Blob. */
export async function readFile(path) {
  const target = await realPath(path);
  const blob = usingHost() ? await readPath(target) : await opfsRead(opfsKey(target));
  if (!blob) throw missingError(path);
  return blob instanceof Blob ? blob : new Blob([blob]);
}

/** Write a Blob to a path, creating the folder when needed. Returns the FSItem. */
export async function writeFile(path, blob, { dedupe = false, overwrite = !dedupe } = {}) {
  const target = await realPath(path);
  if (!target) throw new Error('This computer has nowhere to save to yet');
  const source = blob instanceof Blob ? blob : new Blob([blob]);
  let finalPath = target;
  if (!overwrite && await statEntry(target)) {
    if (!dedupe) throw Object.assign(new Error(`A file already exists at ${target}`), { code: 'EEXIST' });
    // 撞名时另起一个名字（Puter 的 dedupeName 就是这个语义），而不是覆盖。
    const dir = host.dirName(target);
    const taken = dir ? (await host.listDir(dir)).map((e) => e.name) : [];
    finalPath = dir ? `${dir}/${dedupeName(host.baseName(target), taken)}` : dedupeName(host.baseName(target), taken);
  }
  if (usingHost()) {
    await writeToPath(finalPath, source);
  } else {
    await opfsWrite(opfsKey(finalPath), source);
  }
  // 写完再取一次时间戳：冲突检测拿它跟目录列举里的 mtime 比，必须是同一把尺子。
  const written = await statEntry(finalPath);
  return { path: finalPath, name: host.baseName(finalPath), size: source.size, modified: written?.modified ?? null };
}

/** Create a fresh file atomically and retain its actual name if another writer wins a collision. */
export async function createFile(path, blob) {
  return (await createFileWithMetadata(path, blob)).path;
}

/** Create a file and retain the returned timestamp for the next conflict check. */
export async function createFileWithMetadata(path, blob) {
  const item = await writeFile(path, blob, { dedupe: true });
  // Keep the caller's directory representation (app-relative or absolute),
  // exactly as upstream does: only the name may have changed to dodge a collision.
  const name = item?.name || displayName(item?.path || path);
  const target = `${String(path).slice(0, String(path).lastIndexOf('/') + 1)}${name}`;
  return { path: target, modified: item?.modified ?? null };
}

export async function deleteFile(path) {
  const target = await realPath(path);
  if (!target) return;
  if (usingHost()) await host.removeEntry(target, { recursive: false });
  else await opfsRemove(opfsKey(target));
}

/** Remove a folder and everything in it. */
export async function deleteFolder(path) {
  const target = await realPath(path);
  if (!target) return;
  if (usingHost()) { await host.removeEntry(target, { recursive: true }); return; }
  for (const entry of await opfsEntriesUnder(target)) await opfsRemove(opfsKey(entry.path));
}

/** Everything directly inside a folder ({ name, path, size, modified, isDir }); [] when it does not exist. */
export async function listFolder(path) {
  const target = await realPath(path);
  let items;
  try {
    items = usingHost()
      ? await host.listDir(target || '')
      : await opfsEntriesUnder(target);
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
  return (items || []).map((it) => ({
    name: it.name,
    path: it.path || `${target}/${it.name}`,
    size: it.size ?? 0,
    modified: it.modified ?? 0,
    isDir: !!(it.is_dir || it.isDir),
  }));
}

export async function renameFile(path, newName) {
  const target = await realPath(path);
  const clean = host.baseName(String(newName || ''));
  if (!target || !clean) return null;
  const dir = host.dirName(target);
  const to = dir ? `${dir}/${clean}` : clean;
  if (usingHost()) await host.renameEntry(target, to);
  else {
    const file = await opfsRead(opfsKey(target));
    if (!file) throw missingError(path);
    await opfsWrite(opfsKey(to), file);
    await opfsRemove(opfsKey(target));
  }
  const written = await statEntry(to);
  return { path: await virtualPath(to), name: clean, modified: written?.modified ?? null };
}

export async function statFile(path) {
  try {
    return await statEntry(path);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function fileExists(path) {
  return !!(await statEntry(path));
}

/** A name that does not collide with an existing file in the folder. */
export async function uniqueName(base) {
  const stem = stripExtension(base) || 'Untitled document';
  let name = `${stem}.docx`;
  if (!await fileExists(`${FOLDER}/${name}`)) return name;
  // Read collisions together: many untitled documents must not turn the first
  // autosave into hundreds of sequential round trips.
  let names;
  try { names = new Set((await listFolder(FOLDER)).map((item) => item.name)); }
  catch { /* Keep stat-based naming available when listing is not permitted. */ }
  let n = 2;
  do { name = `${stem} ${n++}.docx`; }
  while (names ? names.has(name) : await fileExists(`${FOLDER}/${name}`));
  return name;
}

/* ---------- Pickers ---------- */

export function canPickFiles() {
  // 只有宿主在时才给「打开」对话框：浏览器兜底拿不到路径，交给设备导入。
  return usingHost();
}

export function canSaveFiles() {
  return true;
}

/** The host's Open dialog -> { path, name } or null when cancelled. Documents by default. */
export async function pickFile({ accept = DOCUMENT_EXTENSIONS } = {}) {
  if (!canPickFiles()) return null;
  const list = Array.isArray(accept) ? accept.join(',') : accept;
  let files;
  try {
    files = await importFiles({ accept: list, multiple: false, title: 'Open' });
  } catch {
    return null;
  }
  const item = files?.[0];
  if (!item || !item.path) return null;
  return { path: item.path, name: item.name || displayName(item.path), item };
}

/**
 * Pick an image on this device and read it: a File (named and typed like the
 * original) ready for the page, or null when cancelled.
 */
export async function pickImage() {
  const picked = await pickFile({ accept: IMAGE_EXTENSIONS });
  if (!picked) return null;
  const blob = await readFile(picked.path);
  return new File([blob], picked.name, { type: blob.type || mimeFor(picked.name) || 'application/octet-stream' });
}

/**
 * The host's Save dialog with content. When the user cancels there is no path.
 */
export async function saveFileAs(blob, suggestedName) {
  if (!canSaveFiles()) return null;
  const saved = await exportFile(blob instanceof Blob ? blob : new Blob([blob]), suggestedName);
  if (!saved?.path) return null;
  return { path: saved.path, name: saved.name || displayName(saved.path) };
}

/* ---------- Small per-user settings ---------- */

/** Puter's key-value store is a cloud account's; this build has none. */
export function canUseKv() {
  return false;
}

/** A per-user setting from Puter's key-value store, or null. */
export async function kvGet(key) {
  void key;
  return null;
}

/** Save a per-user setting in Puter's key-value store. */
export async function kvSet(key, value) {
  void key; void value;
}

/* ---------- AI ---------- */

const unavailable = (what) => new Error(`${what} needs a Puter account. This build keeps everything on this computer.`);

/** Whether Puter's AI is reachable (puter.ai.chat). */
export function canUseAi() {
  return false;
}

/** One chat completion for a prompt; resolves the SDK's response object. */
export function aiChat(prompt, options = {}) {
  void prompt; void options;
  throw unavailable('The writing assistant');
}

/** Whether Puter can make pictures from text (puter.ai.txt2img). */
export function canMakeImages() {
  return false;
}

/** A picture for a description; resolves the SDK's <img> element. */
export function makeImage(prompt, options = {}) {
  void prompt; void options;
  throw unavailable('Image generation');
}

/** Whether Puter's text-to-speech is reachable (puter.ai.txt2speech). */
export function canSpeak() {
  return false;
}

/** Speech for a piece of text; resolves an HTMLAudioElement ready to play. */
export async function speak(text, options = {}) {
  void text; void options;
  throw unavailable('Read aloud');
}

/* ---------- Hosting ---------- */

/** Whether Puter hosting (puter.site subdomains) is reachable. */
export function canHost() {
  return false;
}

export function hostingCreate(subdomain, dirPath) {
  void subdomain; void dirPath;
  throw unavailable('Publishing');
}

export function hostingUpdate(subdomain, dirPath) {
  void subdomain; void dirPath;
  throw unavailable('Publishing');
}

export function hostingDelete(subdomain) {
  void subdomain;
  throw unavailable('Publishing');
}

/* ---------- Desktop integration ---------- */

export function setWindowTitle(title) {
  try { if (title) document.title = String(title); } catch { /* not in a window */ }
}

/** Register for "Open with" launches from the Puter desktop: the host has no such channel. */
export function onLaunchedWithItems(handler) {
  void handler;
}

/**
 * Hand a Blob to the user: a real file through the host's Save dialog,
 * or, without the host, a browser download.
 */
export function downloadBlob(blob, filename) {
  const source = blob instanceof Blob ? blob : new Blob([blob]);
  if (usingHost()) {
    void exportFile(source, filename);
    return;
  }
  browserDownload(source, filename);
}
