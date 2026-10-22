/**
 * documents 插件 MCP 工具汇总。
 * ------------------------------------------------------------------
 * 文件级工具在 `mcp.js`，领域级在 `mcp-documents-tools.js`。入口 `boot.js` 调
 * `installMcpBridge({ extraTools: documentsMcpTools() })` 一并挂给宿主。
 */
import { mcpToolNames } from './mcp.js';
import { documentsMcpTools } from './mcp-documents-tools.js';

export { documentsMcpTools };

/** 完整工具名清单（文件级 + 领域级），顺序须与 plugin.json 的 mcp.expose 一致。 */
export function documentsToolNames() {
  return [...mcpToolNames(), ...documentsMcpTools().map((tool) => tool.name)];
}
