/**
 * documents 插件的领域级 MCP 工具（"应用级"MCP 第一批）。
 * ------------------------------------------------------------------
 * 直接驱动当前文档的 canvas 引擎（`view.engine`）：读全文/选区/统计、设选区、
 * 插入/替换文本、追加、保存。编辑走 `engine.execute(() => model.replace(text))`
 * ——和界面输入同一撤销栈，界面会跟着变。
 *
 * 由 `mcp-tools.js` 汇总，入口 `installMcpBridge({ extraTools })` 挂给宿主。
 */
import { requireView, requireEngine, text } from './mcp-context.js';
import { countWords, countCharacters, countParagraphs } from '../core/text.js';

/** 选区位置校验：0..文本长度的整数。 */
function clampPos(value, length, what) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${what} must be a number.`);
  return Math.max(0, Math.min(length, Math.round(n)));
}

async function runGetDocument() {
  const view = requireView();
  const doc = view.doc;
  const engine = view.engine;
  const body = engine?.model?.text ?? '';
  return text({
    name: doc.name,
    path: doc.path || null,
    status: doc.status,
    dirty: Boolean(doc.dirty),
    pageCount: engine?.layout?.pageCount ?? null,
    words: countWords(body),
    characters: countCharacters(body),
    paragraphs: countParagraphs(body),
  });
}

async function runReadText() {
  const view = requireView();
  const engine = requireEngine(view);
  const body = engine.model.text;
  return text({ text: body, length: body.length });
}

async function runGetSelection() {
  const view = requireView();
  const engine = requireEngine(view);
  const [start, end] = engine.model.range;
  return text({ start, end, text: engine.model.clipboardText() });
}

async function runSelectRange(args) {
  const view = requireView();
  const engine = requireEngine(view);
  const len = engine.model.text.length;
  const start = clampPos(args.start, len, 'start');
  const end = clampPos(args.end, len, 'end');
  engine.model.selection = { anchor: start, focus: end };
  return text({ start: Math.min(start, end), end: Math.max(start, end) });
}

async function runInsertText(args) {
  const view = requireView();
  const engine = requireEngine(view);
  const value = args.text == null ? '' : String(args.text);
  if (!value) throw new Error('text is required.');
  engine.execute(() => engine.model.replace(value));
  const [start, end] = engine.model.range;
  return text({ inserted: value.length, cursor: end, start, end });
}

async function runAppendText(args) {
  const view = requireView();
  const engine = requireEngine(view);
  const value = args.text == null ? '' : String(args.text);
  if (!value) throw new Error('text is required.');
  const len = engine.model.text.length;
  engine.model.selection = { anchor: len, focus: len };
  engine.execute(() => engine.model.replace(value));
  return text({ appended: value.length, length: engine.model.text.length });
}

async function runSave() {
  const view = requireView();
  const ok = await view.flush();
  return text({ saved: Boolean(ok), status: view.doc.status });
}

export function documentsMcpTools() {
  return [
    {
      name: 'get_document',
      title: 'Describe the open document',
      description:
        'Return the open document: name, file path, save status, page count, and word/character/paragraph counts. Call this first.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
      run: runGetDocument,
    },
    {
      name: 'read_text',
      title: 'Read the document text',
      description: 'Return the whole document as plain text (paragraphs separated by newlines).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
      run: runReadText,
    },
    {
      name: 'get_selection',
      title: 'Read the current selection',
      description: 'Return the current selection: start/end offsets and the selected text.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
      run: runGetSelection,
    },
    {
      name: 'select_range',
      title: 'Select a range of text',
      description: 'Set the text selection to [start, end) offsets. Used before insert_text to position the caret.',
      inputSchema: {
        type: 'object',
        properties: {
          start: { type: 'number', description: 'Start offset (0-based).' },
          end: { type: 'number', description: 'End offset (0-based, exclusive).' },
        },
        required: ['start', 'end'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runSelectRange,
    },
    {
      name: 'insert_text',
      title: 'Insert or replace text at the selection',
      description:
        'Insert text at the caret, or replace the current selection with it (one undoable step). Use select_range first to place the caret.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to insert or replace the selection with.' } },
        required: ['text'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runInsertText,
    },
    {
      name: 'append_text',
      title: 'Append text to the end of the document',
      description: 'Append text at the end of the document body (one undoable step).',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to append.' } },
        required: ['text'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runAppendText,
    },
    {
      name: 'save',
      title: 'Save the document',
      description: 'Save the open document to its file now (autosave also runs). Returns whether it was written.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runSave,
    },
  ];
}
