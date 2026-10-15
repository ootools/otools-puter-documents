import { test, expect } from '@playwright/test';

const input = page => page.getByRole('textbox', { name: 'Document text' });
const selected = page => input(page).evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd));
const paragraph = 'This paragraph is long enough to wrap onto a second line of the page, so a triple click on that second line still selects all of it.';

test('a triple click selects the whole paragraph, including wrapped lines, and typing replaces only it', async ({ page }) => {
  await page.goto('/mock.html#/new');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  await input(page).fill(`Title\n${paragraph}\nLast line`);
  const canvas = page.locator('canvas.canvas-page').first();
  // The second line of the long paragraph, below the 1in margin at 100% zoom.
  const second = { x: 300, y: 163 };
  await canvas.dblclick({ position: second });
  expect((await selected(page)).trim()).toMatch(/^\S+$/u);
  await canvas.click({ position: second, clickCount: 3 });
  expect(await selected(page)).toBe(paragraph);
  await page.keyboard.insertText('Replaced');
  await expect(input(page)).toHaveValue('Title\nReplaced\nLast line');
  await input(page).press('ControlOrMeta+z');
  await expect(input(page)).toHaveValue(`Title\n${paragraph}\nLast line`);
  // Shift keeps extending the existing selection rather than taking a paragraph.
  await canvas.click({ position: { x: 100, y: 108 } });
  await canvas.click({ position: second, clickCount: 3, modifiers: ['Shift'] });
  expect(await selected(page)).not.toBe(paragraph);
});
