import { it, expect } from 'vitest';
import { buildPdf, pageFragments, textLayer, utf16Hex } from '../src/lib/pdf-export.js';

// A 1×1 baseline JPEG (independently written bytes).
const JPEG = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k='), c => c.charCodeAt(0));

it('writes a PDF whose cross-reference offsets point at their objects', () => {
  const page = { widthPx: 816, heightPx: 1056, jpeg: JPEG, imageWidth: 1, imageHeight: 1, fragments: [{ text: 'Hello café 漢字', x: 96, baseline: 120, width: 120, fontSize: 12 }] };
  const bytes = buildPdf([page, { ...page, fragments: [] }], { title: 'Report (draft)' });
  const text = new TextDecoder('latin1').decode(bytes);
  expect(text.startsWith('%PDF-1.7')).toBe(true);
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
  expect(text.slice(xref, xref + 4)).toBe('xref');
  const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  offsets.forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
  expect(text).toContain(`<${utf16Hex('Hello café 漢字')}> Tj`);
  expect(text).toContain('/Title (Report \\(draft\\))');
});

it('places invisible text at the run\'s baseline, scaled to its painted width', () => {
  const ops = textLayer([{ text: 'Abc', x: 100, baseline: 200, width: 40, fontSize: 10 }], 1056);
  expect(ops).toContain('3 Tr');
  expect(ops).toContain('1 0 0 1 75.00 642.00 Tm');
  expect(ops).toContain('/F1 10.00 Tf 200.00 Tz');
});

it('collects page text from body and story lines, skipping pictures and rotated cells', () => {
  const lines = [
    { page: 0, baseline: 50, fragments: [{ text: 'Body', x: 10, width: 30, fontSize: 12 }, { image: {}, text: '', x: 50 }] },
    { page: 0, baseline: 900, pageStory: 'word/footer1.xml', fragments: [{ text: 'Footer', x: 10, width: 40, fontSize: 10 }] },
    { page: 0, baseline: 60, cellText: { matrix: [0, 1, -1, 0] }, fragments: [{ text: 'Rotated', x: 0, width: 1, fontSize: 9 }] },
    { page: 1, baseline: 50, fragments: [{ text: 'Next', x: 0, width: 1, fontSize: 9 }] },
  ];
  expect(pageFragments(lines, 0).map(f => f.text)).toEqual(['Body', 'Footer']);
});
