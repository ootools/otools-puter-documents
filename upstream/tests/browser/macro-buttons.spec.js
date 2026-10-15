import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

test('renders MACROBUTTON field labels as inert text and downloads the untouched source', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    window.labelPaint = [];
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
      if (text === 'Split ' || text === 'label') window.labelPaint.push({ text, font: this.font, color: this.fillStyle });
      return fillText.call(this, text, x, y, ...rest);
    };
  });
  await page.goto('/playground.html');
  const source = 'public/fixtures/macro-button-labels.docx';
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/Unquoted: \[Last, First Name of Author\]/);
  await expect(input).toHaveAttribute('readonly');
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const original = await input.inputValue();
  expect(original).toContain('Quoted: "Quoted display label"  | end');
  expect(original).toContain('Locked: Locked instruction | end');
  expect(original).toContain('Simple: Simple display | end');
  expect(original).toContain('Not a button: Cached date | end');
  expect(original).not.toMatch(/MACROBUTTON|DoFieldClick|NoMacro|Command With Spaces|Stale cached/);
  const painted = await page.evaluate(() => window.labelPaint);
  expect(painted.some(p => p.text === 'Split ' && /bold|700/.test(p.font) && p.color === '#2050c0')).toBe(true);
  expect(painted.some(p => p.text === 'label' && /italic/.test(p.font) && p.color === '#c02050')).toBe(true);
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.type('No changes');
  await expect(input).toHaveValue(original);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('macro-button-labels.docx'); await (await pending).saveAs(saved);
  expect(readFileSync(saved).equals(readFileSync(source))).toBe(true);
  const image = await page.locator('canvas.canvas-page').evaluate(c => c.toDataURL());
  writeFileSync(testInfo.outputPath('page1.png'), Buffer.from(image.split(',')[1], 'base64'));
  expect(errors).toEqual([]);
});
