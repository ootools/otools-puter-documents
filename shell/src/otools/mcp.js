/**
 * 宿主 MCP 网关的插件侧桥（webview 后端）。
 * ------------------------------------------------------------------
 * 宿主在插件 webview 里 eval 一段脚本，脚本读 `window.__otoolsMcp` 的两个方法：
 *
 *   listTools()       → 本插件对外暴露的工具表
 *   call(name, args)  → 执行工具，返回 MCP 形状的 { content, isError }
 *
 * **回传由宿主脚本负责**：宿主后端在拿到返回值后自己调 `mcp_webview_resolve`
 * 把结果交回网关，插件不需要知道 requestId，也不该自己调回传命令。这样插件
 * 只关心「我的工具有哪些、怎么执行」，与传输细节解耦。
 *
 * 本桥与 `@/plugins/shared/mcp-webview-bridge.ts` 语义一致，但那个模块属于宿主
 * 仓库（TypeScript，且不在本插件的构建树里），这里按同一契约用本插件的 JS
 * 风格实现一份——五个 puter-* 插件共用同一套移植层写法，不引入 TS 构建步骤。
 *
 * 边界（与宿主 spec §10.1 的「已知脆性」对应）：
 *   - 只在宿主里才挂载（普通浏览器里挂一个没有宿主的 MCP 桥没有意义）；
 *   - 工具表拿不到时返回空表，让宿主把本插件视为「暂无工具」，而不是整段脚本失败；
 *   - call 抛错时转成 isError，让 AI 读到可行动的错误而不是空响应
 *     （Windows 上 Tauri 会忽略脚本异常，抛异常传不出去）。
 */

import { listLibrary, readFromLibrary } from './local.js';
import { t } from './i18n.js';
import { APP } from './app.js';

/** 工具表：先只暴露一个只读工具（列出库目录里的文档）。 */
function toolDefs() {
  return [
    {
      name: 'list_documents',
      title: t('List documents'),
      description: t('List the documents in the {product} library folder (name, size and modified time).', { product: APP.product }),
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'read_document_bytes',
      title: t('Read document text'),
      description: t('Read one document from the library and return its raw bytes as base64. Binary formats (such as .docx) are returned as stored, not decoded.', { product: APP.product }),
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: t('File name inside the library folder') } },
        required: ['name'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  ];
}

const textResult = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError: false });
const errorResult = (error) => ({ content: [{ type: 'text', text: String((error && error.message) || error) }], isError: true });

/** 名字守卫：只允许库目录里的普通文件名，挡掉 `../` 这类越界。 */
function safeLeaf(name) {
  const value = String(name || '').trim();
  if (!value) throw new Error(t('A file name is required'));
  if (value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new Error(t('Only a plain file name inside the library folder is allowed'));
  }
  return value;
}

async function run(name, args) {
  const call = String(name || '');
  const input = args && typeof args === 'object' ? args : {};

  switch (call) {
    case 'list_documents': {
      const entries = await listLibrary();
      return textResult({
        documents: entries.map((e) => ({ name: e.name, size: e.size, modified: e.modified })),
      });
    }
    case 'read_document_bytes': {
      const leaf = safeLeaf(input.name);
      const blob = await readFromLibrary(leaf);
      if (!blob) throw new Error(t('No such document in the library folder: {name}', { name: leaf }));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      return textResult({ name: leaf, mime: blob.type || '', size: bytes.length, base64: btoa(binary) });
    }
    default:
      throw new Error(t('Unknown tool: {name}', { name: call }));
  }
}

/**
 * 把桥挂到 `window.__otoolsMcp`。幂等：重复调用只覆盖一次同形状的对象，
 * 不叠加监听或状态。
 */
export function installMcpBridge() {
  if (typeof window === 'undefined') return;

  window.__otoolsMcp = {
    listTools: async () => {
      try {
        return toolDefs();
      } catch {
        // 工具表拿不到时返回空表：宿主会把本插件视为「暂无工具」。
        return [];
      }
    },
    call: async (name, args) => {
      try {
        return (await run(name, args)) || { content: [] };
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}

/** 供测试与诊断：工具名清单（不触发 i18n 之外的副作用）。 */
export function mcpToolNames() {
  return toolDefs().map((tool) => tool.name);
}
