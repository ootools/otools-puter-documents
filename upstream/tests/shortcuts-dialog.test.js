// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { openShortcuts } from '../src/ui/shortcuts.js';
import { MOD_KEY } from '../src/ui/dom.js';

beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {} })); });
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); document.body.className = ''; });

it('lists only chords the canvas editor handles, with alternatives joined by "or"', () => {
  openShortcuts();
  const text = document.querySelector('.modal-panel').textContent;
  for (const promised of ['Small caps', 'Increase font size', 'Column break', 'Update page references', 'Heading 1 to 6', 'Previous or next paragraph', 'Show keyboard shortcuts', 'Paste without formatting', 'Move paragraphs up or down', 'Check spelling', 'Font dialog']) expect(text).toContain(promised);
  for (const gone of ['Focus mode', 'Go to page', 'Insert footnote', 'Comment on the selection', 'Word count', 'Zoom in']) expect(text).not.toContain(gone);
  const redo = [...document.querySelectorAll('.modal-panel dd')].find(dd => dd.textContent === 'Redo').previousElementSibling;
  expect(redo.textContent).toBe(`${MOD_KEY} + Shift + Z or ${MOD_KEY} + Y`);
  expect(redo.querySelectorAll('.kbd')).toHaveLength(5);
});
