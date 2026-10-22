// @vitest-environment jsdom
/**
 * 插件侧 MCP 桥的边界。
 *
 * 只测「契约」——宿主读 `window.__otoolsMcp` 能得到什么形状、异常怎么变成
 * isError、路径守卫挡不挡越界、写工具落点对不对；不测文案翻译（这些描述是
 * 给 AI 读的，本来就不进 i18n 词表）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const LIB = '/Users/local/Documents';

vi.mock('../src/otools/local.js', () => ({
  libraryDir: vi.fn(),
}));

vi.mock('../src/otools/host.js', () => ({
  joinPath: vi.fn(async (...parts) => parts.filter(Boolean).join('/')),
  dirName: vi.fn((p) => {
    const at = String(p).lastIndexOf('/');
    return at > 0 ? String(p).slice(0, at) : '';
  }),
  listDir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createDir: vi.fn(),
}));

import { installMcpBridge, mcpToolDefs, mcpToolNames } from '../src/otools/mcp.js';
import { libraryDir } from '../src/otools/local.js';
import * as host from '../src/otools/host.js';
import { documentsMcpTools, documentsToolNames } from '../src/otools/mcp-tools.js';
import { setDocumentsMcpContext } from '../src/otools/mcp-context.js';

const bridge = () => window.__otoolsMcp;

/** 一个内存假引擎：只实现领域工具真正用到的 model 成员与 execute。 */
function fakeView(body = 'Hello world') {
  const model = {
    text: body,
    selection: { anchor: 0, focus: 0 },
    get range() {
      return [Math.min(model.selection.anchor, model.selection.focus), Math.max(model.selection.anchor, model.selection.focus)];
    },
    clipboardText() {
      const [a, b] = model.range;
      return model.text.slice(a, b);
    },
    replace(value) {
      const [a, b] = model.range;
      model.text = model.text.slice(0, a) + value + model.text.slice(b);
      model.selection = { anchor: a + value.length, focus: a + value.length };
    },
  };
  const engine = { model, layout: { pageCount: 1 }, execute: (fn) => fn() };
  return {
    doc: { name: 'Doc', path: '/Documents/Doc.docx', status: 'saved', dirty: false },
    engine,
    flush: vi.fn(async () => true),
  };
}

describe('MCP 桥', () => {
  beforeEach(() => {
    delete window.__otoolsMcp;
    vi.clearAllMocks();
    libraryDir.mockResolvedValue(LIB);
    host.listDir.mockResolvedValue([]);
    host.readFile.mockResolvedValue(null);
    installMcpBridge({ extraTools: documentsMcpTools() });
  });

  it('挂载 window.__otoolsMcp 且暴露 listTools/call', () => {
    expect(typeof bridge().listTools).toBe('function');
    expect(typeof bridge().call).toBe('function');
  });

  it('listTools 返回带 name/inputSchema/annotations 的工具表', async () => {
    const tools = await bridge().listTools();
    expect(tools.map((tool) => tool.name)).toEqual(documentsToolNames());
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.inputSchema).toBeTypeOf('object');
      expect(tool.annotations).toBeTypeOf('object');
    }
  });

  it('list_library 映射宿主条目并跳过库标记文件', async () => {
    host.listDir.mockResolvedValue([
      { name: 'documents.json', isDir: false, size: 1, modified: 1 },
      { name: 'a.docx', isDir: false, size: 12, modified: 5 },
      { name: 'archive', isDir: true, size: 0, modified: 6 },
    ]);

    const result = await bridge().call('list_library', {});
    expect(result.isError).toBe(false);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.entries).toEqual([
      { path: 'a.docx', name: 'a.docx', kind: 'file', size: 12, modified: 5 },
      { path: 'archive', name: 'archive', kind: 'directory', size: 0, modified: 6 },
    ]);
    expect(host.listDir).toHaveBeenCalledWith(LIB);
  });

  it('list_library 支持子目录并把相对路径拼进条目', async () => {
    host.listDir.mockResolvedValue([{ name: 'q3.docx', isDir: false, size: 3, modified: 9 }]);
    const result = await bridge().call('list_library', { path: 'reports' });
    const payload = JSON.parse(result.content[0].text);
    expect(host.listDir).toHaveBeenCalledWith(`${LIB}/reports`);
    expect(payload.entries[0].path).toBe('reports/q3.docx');
  });

  it('read_file 返回 base64 内容与元信息', async () => {
    host.readFile.mockResolvedValue({
      name: 'a.txt',
      size: 2,
      mime: 'text/plain',
      dataBase64: 'aGk=',
    });
    const result = await bridge().call('read_file', { path: 'a.txt' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual({
      path: 'a.txt',
      size: 2,
      mime: 'text/plain',
      base64: 'aGk=',
    });
  });

  it('read_file 拒绝跳出库目录的路径', async () => {
    const result = await bridge().call('read_file', { path: '../secret.txt' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/inside the library folder/);
    expect(host.readFile).not.toHaveBeenCalled();
  });

  it('read_file 拒绝绝对路径', async () => {
    const result = await bridge().call('read_file', { path: '/etc/passwd' });
    expect(result.isError).toBe(true);
    expect(host.readFile).not.toHaveBeenCalled();
  });

  it('read_file 对不存在的文件返回 isError', async () => {
    const result = await bridge().call('read_file', { path: 'missing.txt' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No such file/);
  });

  it('write_file 建父目录并写入 base64', async () => {
    const result = await bridge().call('write_file', {
      path: 'exports/deck.pptx',
      base64: 'aGk=',
    });
    expect(result.isError).toBe(false);
    expect(host.createDir).toHaveBeenCalledWith(`${LIB}/exports`);
    expect(host.writeFile).toHaveBeenCalledWith(`${LIB}/exports/deck.pptx`, 'aGk=');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      path: 'exports/deck.pptx',
      bytes: 2,
    });
  });

  it('write_file 缺 base64 时返回 isError 且不落盘', async () => {
    const result = await bridge().call('write_file', { path: 'a.txt' });
    expect(result.isError).toBe(true);
    expect(host.writeFile).not.toHaveBeenCalled();
  });

  it('业务能力抛错时由桥转成 isError', async () => {
    host.listDir.mockRejectedValue(new Error('disk gone'));
    const result = await bridge().call('list_library', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('disk gone');
  });

  it('未知工具返回 isError，而不是抛异常', async () => {
    const result = await bridge().call('nope', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown tool/);
  });

  it('宿主不在时给出可行动的说明', async () => {
    libraryDir.mockResolvedValue('');
    const result = await bridge().call('list_library', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/OTools host is not available/);
  });

  it('extraTools 可以追加领域工具，run 不会外泄给宿主', async () => {
    delete window.__otoolsMcp;
    const run = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }));
    installMcpBridge({ extraTools: [{ name: 'domain_tool', description: 'x', run }] });

    const tools = await bridge().listTools();
    const added = tools.find((tool) => tool.name === 'domain_tool');
    expect(added).toBeTruthy();
    expect(added.run).toBeUndefined();

    const result = await bridge().call('domain_tool', { a: 1 });
    expect(run).toHaveBeenCalledWith({ a: 1 });
    expect(result.content[0].text).toBe('ok');
  });

  it('工具表与 plugin.json 的 mcp 声明一致', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(here, '..', '..', 'plugin.json'), 'utf8'),
    );
    expect(manifest.mcp.enabled).toBe(true);
    expect(manifest.mcp.backend).toBe('webview');
    expect(manifest.mcp.namespace).toBe('puter-documents');
    expect(manifest.mcp.expose).toEqual(documentsToolNames());
    for (const tool of [...mcpToolDefs(), ...documentsMcpTools()]) {
      expect(manifest.mcp.annotations?.[tool.name]).toBeTypeOf('object');
    }
  });
});

describe('MCP 领域工具（documents）', () => {
  let view;
  beforeEach(() => {
    delete window.__otoolsMcp;
    vi.clearAllMocks();
    installMcpBridge({ extraTools: documentsMcpTools() });
    view = fakeView('Hello world');
    setDocumentsMcpContext({ editorContext: () => view });
  });

  it('get_document 报出名称/路径/统计', async () => {
    const result = await bridge().call('get_document', {});
    expect(result.isError).toBe(false);
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({ name: 'Doc', path: '/Documents/Doc.docx', pageCount: 1, words: 2, characters: 11, paragraphs: 1 });
  });

  it('read_text 返回全文', async () => {
    const result = await bridge().call('read_text', {});
    expect(JSON.parse(result.content[0].text)).toMatchObject({ text: 'Hello world', length: 11 });
  });

  it('select_range + insert_text 在选区插入/替换', async () => {
    await bridge().call('select_range', { start: 6, end: 11 });
    const ins = await bridge().call('insert_text', { text: 'there' });
    expect(ins.isError).toBe(false);
    expect(view.engine.model.text).toBe('Hello there');
  });

  it('get_selection 返回选中的文本', async () => {
    await bridge().call('select_range', { start: 0, end: 5 });
    const sel = JSON.parse((await bridge().call('get_selection', {})).content[0].text);
    expect(sel).toEqual({ start: 0, end: 5, text: 'Hello' });
  });

  it('append_text 追加到结尾', async () => {
    const result = await bridge().call('append_text', { text: '!' });
    expect(result.isError).toBe(false);
    expect(view.engine.model.text).toBe('Hello world!');
  });

  it('save 调用 view.flush', async () => {
    const result = await bridge().call('save', {});
    expect(result.isError).toBe(false);
    expect(view.flush).toHaveBeenCalled();
  });

  it('insert_text 拒绝空文本', async () => {
    const result = await bridge().call('insert_text', { text: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/text is required/);
  });

  it('没打开文档时领域工具给出可行动说明', async () => {
    setDocumentsMcpContext({ editorContext: () => null });
    const result = await bridge().call('get_document', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No document is open/);
  });
});
