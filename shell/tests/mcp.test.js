// @vitest-environment jsdom
/**
 * 插件侧 MCP 桥的边界。
 *
 * 只测「契约」——宿主读 `window.__otoolsMcp` 能得到什么形状、异常怎么变成
 * isError、名字守卫挡不挡越界路径；不测具体翻译词条（交给 i18n-report）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/otools/local.js', () => ({
  listLibrary: vi.fn(),
  readFromLibrary: vi.fn(),
}));

import { installMcpBridge, mcpToolNames } from '../src/otools/mcp.js';
import { listLibrary, readFromLibrary } from '../src/otools/local.js';

const bridge = () => window.__otoolsMcp;

describe('MCP 桥', () => {
  beforeEach(() => {
    delete window.__otoolsMcp;
    listLibrary.mockReset();
    readFromLibrary.mockReset();
    installMcpBridge();
  });

  it('挂载 window.__otoolsMcp 且暴露 listTools/call', () => {
    expect(typeof bridge().listTools).toBe('function');
    expect(typeof bridge().call).toBe('function');
  });

  it('listTools 返回带 name/inputSchema/annotations 的工具表', async () => {
    const tools = await bridge().listTools();
    expect(tools.map((t) => t.name)).toEqual(mcpToolNames());
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.inputSchema).toBeTypeOf('object');
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
  });

  it('list_documents 把库目录条目包成 JSON 文本', async () => {
    listLibrary.mockResolvedValue([{ name: 'a.docx', size: 12, modified: 5 }]);
    const result = await bridge().call('list_documents', {});
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual({
      documents: [{ name: 'a.docx', size: 12, modified: 5 }],
    });
  });

  it('read_document_bytes 返回 base64 内容', async () => {
    readFromLibrary.mockResolvedValue(new Blob([new Uint8Array([104, 105])], { type: 'text/plain' }));
    const result = await bridge().call('read_document_bytes', { name: 'a.txt' });
    expect(result.isError).toBe(false);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.name).toBe('a.txt');
    expect(payload.size).toBe(2);
    expect(atob(payload.base64)).toBe('hi');
  });

  it('read_document_bytes 拒绝越界文件名，不下探到库目录之外', async () => {
    const result = await bridge().call('read_document_bytes', { name: '../secret' });
    expect(result.isError).toBe(true);
    expect(readFromLibrary).not.toHaveBeenCalled();
  });

  it('未知工具返回 isError，而不是抛异常', async () => {
    const result = await bridge().call('nope', {});
    expect(result.isError).toBe(true);
  });

  it('业务能力抛错时由桥转成 isError', async () => {
    listLibrary.mockRejectedValue(new Error('disk gone'));
    const result = await bridge().call('list_documents', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('disk gone');
  });
});
