/**
 * documents 插件 MCP 领域工具的「活上下文」。
 * ------------------------------------------------------------------
 * 参照 video / spreadsheet / audio：入口在编辑器就绪后调
 * `setDocumentsMcpContext()` 把 `editorContext` 交进来，工具被调用时再解析。
 *
 * 上下文形状（由 `shell/overlay/src/main.js` 提供）：
 *
 *   { editorContext }   // () => 当前编辑器 view（views/editor.js 的返回值）；首页时 null
 *
 * 编辑器 view 暴露 `view.doc`（lib/doc.js 的 Doc）与 `view.engine`（canvas 引擎，
 * `engine.model` 是 TextDocument，`engine.execute(fn)` 走事务/撤销）。
 */

let context = null;

export function setDocumentsMcpContext(next) {
  context = next || null;
}

export function getDocumentsMcpContext() {
  return context;
}

/** 当前编辑器 view；没打开文档时给出可行动的说明。 */
export function requireView() {
  const view = context && typeof context.editorContext === 'function' ? context.editorContext() : null;
  if (!view || !view.doc) {
    throw new Error('No document is open in the editor. Open one in the app, then retry.');
  }
  return view;
}

/** view 的 canvas 引擎；文档还在加载时给出说明。 */
export function requireEngine(view) {
  const engine = view.engine;
  if (!engine || !engine.model) {
    throw new Error('The document is still loading. Try again in a moment.');
  }
  return engine;
}

/** MCP 形状的文本结果。 */
export const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  isError: false,
});
