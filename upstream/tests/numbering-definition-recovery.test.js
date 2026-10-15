import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
import { listMarkers, NumberingDefinitionError } from '../src/engine/numbering.js';
import { resolveStyledParagraph } from '../src/engine/styles.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/numbering-definition-recovery/${name}.docx`);
const sameParts = (a, b) => { expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort()); for (const name of Object.keys(a)) expect(Buffer.from(a[name]).equals(Buffer.from(b[name])), name).toBe(true); };

it.each([
  ['format', 'Unsupported numbering format'], ['inherited', 'Unsupported numbering format'],
  ['missing', 'missing numbering definition'], ['missing-level', 'Numbering level 2 is missing'],
  ['override', 'Unsupported numbering format'],
])('keeps rich paragraphs and neighboring lists when a definition fails: %s', async (name, issue) => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow(issue);
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true);
  expect(pkg.previewIssues.some(message => message.includes(issue))).toBe(true);
  sameParts(pkg.parts, unzipSync(bytes));
  const args = [pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets];
  const doc = new TextDocument(...args, { displayOnly: true });
  const header = pkg.pageStories.stories['word/header1.xml'];
  const story = new TextDocument(header.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, header.tables, pkg.assets, { displayOnly: true });
  expect(pkg.tables).toHaveLength(1);
  for (const number of [10, 20, 30]) {
    const p = [...doc.paragraphs, ...story.paragraphs].find(p => paragraphText(p).startsWith(`Retained ${number}`));
    expect(p.format.indentLeft).toBe(540);
    expect(p.runs.filter(run => run.image)).toHaveLength(1);
    expect(p.runs.filter(run => !run.image).map(run => run.text).join('')).toBe(`Retained ${number}After picture`);
    expect(p.list).toBeNull();
    expect(p.previewNumberingError).toContain(issue);
    expect(p.runs[0]).toMatchObject({ bold: true, color: '204080', fontSize: 18 });
    expect(p.runs.at(-1).italic).toBe(true);
  }
  expect(listMarkers(doc.paragraphs, pkg.numbering).filter(Boolean).map(marker => marker.text)).toEqual(['1.', '2.']);
  expect(listMarkers(story.paragraphs, pkg.numbering).filter(Boolean).map(marker => marker.text)).toEqual(['1.']);
  expect(() => new TextDocument(...args)).toThrow(NumberingDefinitionError);
  expect(() => pkg.export()).toThrow('read-only');
});

it('preserves editable supported content and the original package', async () => {
  const pkg = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).not.toBe(true);
  sameParts(unzipSync(new Uint8Array(await pkg.export().arrayBuffer())), unzipSync(source('healthy')));
});

it('does not hide an unrelated style error behind numbering recovery', async () => {
  const pkg = await DocxPackage.open(source('format'), { bestEffort: true });
  const p = pkg.paragraphs.find(p => paragraphText(p).startsWith('Retained 10'));
  pkg.styles.definitions.Heading.basedOn = 'Heading';
  expect(() => resolveStyledParagraph(p, pkg.styles, pkg.numbering, { displayOnly: true, onNumberingError() {} })).toThrow('Cyclic style inheritance');
});
