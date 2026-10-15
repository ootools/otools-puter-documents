import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function choose(input, text, end = false) {
  await input.evaluate((el, { text, end }) => { const at = el.value.indexOf(text) + (end ? text.length : 0); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); }, { text, end });
}
async function close(page) { if (await page.getByRole('dialog').count()) { await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click(); } else await page.getByRole('button', { name: 'Close document outline' }).click(); }
async function download(page, testInfo, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = testInfo.outputPath(name); await (await event).saveAs(path); return path;
}
const outlines = page => page.getByRole('navigation', { name: 'Document headings' });
async function canvasPixels(page) {
  await page.getByRole('button', { name: 'Document outline', exact: true }).focus();
  return page.locator('canvas.canvas-page').evaluateAll(canvases => canvases.map(c => c.toDataURL()));
}

test('navigates imported outline levels across pages and tables, edits inheritance, and saves unchanged visual formatting', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/outline-levels.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }), level = page.getByRole('combobox', { name: 'Outline level', exact: true }), outline = page.getByRole('button', { name: 'Document outline', exact: true });
  await expect(input).toHaveValue(/^Outline levels/); const pages = await page.locator('canvas.canvas-page').count(), pixels = await canvasPixels(page);
  expect(pages).toBeGreaterThan(3); await expect(outline.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await outline.press('Space'); await expect(outlines(page).getByRole('button')).toHaveCount(11);
  await expect(outlines(page).getByRole('button', { name: /^Level 9: Deep heading/ })).toBeVisible();
  await expect(outlines(page).getByRole('button', { name: /Header heading/ })).toHaveCount(1);
  await page.getByRole('complementary', { name: 'Document outline' }).screenshot({ path: testInfo.outputPath('document-outline.png') });
  const later = outlines(page).getByRole('button', { name: /^Level 1: Later heading/ }), laterPage = Number((await later.getAttribute('aria-label')).match(/page (\d+)$/)[1]);
  await later.focus(); await later.press('Enter'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(input).toBeFocused();
  expect(await input.evaluate(el => el.selectionStart)).toBe((await input.inputValue()).indexOf('Later heading'));
  expect(await page.locator('.canvas-host').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const visible = await input.evaluate((el, index) => { const page = document.querySelectorAll('canvas.canvas-page')[index].getBoundingClientRect(); return el.getBoundingClientRect().top - page.top; }, laterPage - 1); expect(visible).toBeGreaterThanOrEqual(40); expect(visible).toBeLessThan(110);
  await choose(input, 'Nested Á😀'); await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click();
  await expect(page.getByLabel('Style outline level')).toHaveValue('2'); await page.getByLabel('Style outline level').selectOption('5');
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('outline-style.png') }); await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(level).toHaveValue('5');
  await level.selectOption('9'); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(level).toHaveValue('5'); await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(level).toHaveValue('9');
  await choose(input, 'Direct body override'); await level.selectOption('inherit'); await expect(level).toHaveValue('0');
  await choose(input, 'Direct level two'); await level.selectOption('3'); await choose(input, 'Numbered heading'); await level.selectOption('8');
  await expect(page.getByRole('button', { name: 'Numbered list', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await canvasPixels(page)).toEqual(pixels); expect(await page.locator('canvas.canvas-page').count()).toBe(pages);
  await expect(outlines(page).getByRole('button', { name: /Nested Á😀/ })).toHaveCount(0);
  await expect(outlines(page).getByRole('button', { name: /^Level 6: More nested inherited/ })).toBeVisible();
  const header = outlines(page).getByRole('button', { name: /^Level 6: Header heading/ }); await header.click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await input.evaluate(el => el.selectionStart)).toBe((await input.inputValue()).indexOf('Header heading')); await expect(level).toHaveValue('5');
  await choose(input, 'Later heading'); await input.focus(); await page.keyboard.insertText('Revised ');
  const text = await input.inputValue(), saved = await download(page, testInfo, 'outline-levels.docx');
  const original = unzipSync(readFileSync('public/fixtures/outline-levels.docx')), output = unzipSync(readFileSync(saved));
  for (const [name, bytes] of Object.entries(original)) if (!['word/document.xml', 'word/styles.xml'].includes(name)) expect(Buffer.from(output[name]).equals(Buffer.from(bytes)), name).toBe(true);
  await reopenDocx(page, input, saved, text); await outline.click();
  await expect(outlines(page).getByRole('button', { name: /^Level 1: Revised Later heading/ })).toBeVisible();
  await expect(outlines(page).getByRole('button', { name: /^Level 9: Numbered heading/ })).toHaveCount(1); await close(page); expect(errors).toEqual([]);
});

test('authors heading styles, direct levels and empty headings with keyboard navigation and undo', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }), level = page.getByRole('combobox', { name: 'Outline level', exact: true }), style = page.getByRole('combobox', { name: 'Paragraph style', exact: true }), outline = page.getByRole('button', { name: 'Document outline', exact: true });
  await expect(input).toHaveValue(''); await outline.click(); await expect(page.getByText(/No headings yet/)).toBeVisible(); await close(page);
  await input.fill('First heading'); await style.selectOption('Heading1'); await expect(level).toHaveValue('0');
  await input.press('ControlOrMeta+End'); await input.press('Enter'); await expect(style).toHaveValue('Normal'); await expect(level).toHaveValue('9'); await page.keyboard.insertText('Body text');
  await input.press('Enter'); await page.keyboard.insertText('Second heading'); await style.selectOption('Heading2'); await expect(level).toHaveValue('1');
  await input.press('ControlOrMeta+End'); await input.press('Enter'); await level.selectOption('8');
  await outline.click(); await expect(outlines(page).getByRole('button')).toHaveCount(3); await expect(outlines(page).getByRole('button', { name: /^Level 9: \(Empty heading\)/ })).toBeVisible(); await close(page);
  await choose(input, 'Body text'); await level.selectOption('3');
  await choose(input, 'First heading'); await expect(level).toBeDisabled(); await style.selectOption('Normal'); await outline.click(); await expect(outlines(page).getByRole('button', { name: /First heading/ })).toHaveCount(0); await close(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(level).toHaveValue('0'); await expect(level).toBeDisabled();
  await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click(); await expect(page.getByLabel('Style outline level')).toBeDisabled(); await close(page);
  await input.press('ControlOrMeta+a'); await expect(level).toHaveValue('mixed');
  const text = await input.inputValue(), saved = await download(page, testInfo, 'new-outline-levels.docx'); await reopenDocx(page, input, saved, text);
  await outline.click(); await expect(outlines(page).getByRole('button')).toHaveCount(4);
  const body = outlines(page).getByRole('button', { name: /^Level 4: Body text/ }); await body.focus(); await body.press('Enter'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(input).toBeFocused(); expect(await input.evaluate(el => el.selectionStart)).toBe(text.indexOf('Body text')); await expect(level).toHaveValue('3'); expect(errors).toEqual([]);
});

test('previews an out-of-range active outline level as read-only with the original available', async ({ page }) => {
  const parts = unzipSync(readFileSync('public/fixtures/outline-levels.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:outlineLvl w:val="9"/>', '<w:outlineLvl w:val="10"/>'));
  await page.goto('/playground.html'); await showAllTools(page); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^A small beginning/); const before = await input.inputValue();
  await openReadOnlyPreview(page, { name: 'invalid-outline.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });

});
