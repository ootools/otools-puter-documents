import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const input = page => page.getByRole('textbox', { name: 'Document text' });
const pictures = page => page.evaluate(() => window.__docs.current.view.engine.model.paragraphs.flatMap(p => p.runs).filter(r => r.image).length);
const png = [...readFileSync('public/icons/icon-64.png')];

test('a pasted screenshot or copied picture is inserted at the caret', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  try {
    await page.goto('/mock.html#/new');
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    await input(page).fill('Before ');
    await input(page).evaluate((el, bytes) => {
      el.focus(); const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, png);
    await expect.poll(() => pictures(page)).toBe(1);
    await expect(input(page)).toHaveValue('Before ￼');
    await input(page).press('ControlOrMeta+z');
    await expect.poll(() => pictures(page)).toBe(0);
    // Edit > Paste reads the same picture from the system clipboard.
    await page.evaluate(async bytes => navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })]), png);
    await input(page).press('ControlOrMeta+End');
    await page.locator('.ribbon-card').getByRole('button', { name: 'Paste', exact: true }).click();
    await expect.poll(() => pictures(page)).toBe(1);
    // Text on the clipboard beside a picture is pasted as text.
    await input(page).press('ControlOrMeta+End');
    await input(page).evaluate((el, bytes) => {
      el.focus(); const data = new DataTransfer(); data.setData('text/plain', ' caption'); data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, png);
    await expect(input(page)).toHaveValue(/ caption$/);
    expect(await pictures(page)).toBe(1);
  } finally { await context.close(); }
});
