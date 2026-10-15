import { describe, it, expect } from 'vitest';
import { customTemplateId, customTemplatePath, customTemplatesFrom, customTemplateItems, templatePathFor, TEMPLATE_FOLDER } from '../src/lib/customtemplates.js';

describe('custom templates', () => {
  it('round-trips ids and tells them from built-in ones', () => {
    const id = customTemplateId('Documents/Templates/Invoice.docx');
    expect(id).toBe('file:Documents/Templates/Invoice.docx');
    expect(customTemplatePath(id)).toBe('Documents/Templates/Invoice.docx');
    expect(customTemplatePath('letter')).toBeNull();
    expect(customTemplatePath('file:')).toBeNull();
    expect(customTemplatePath(null)).toBeNull();
    expect(TEMPLATE_FOLDER).toBe('Documents/Templates');
    expect(templatePathFor('Invoice')).toBe('Documents/Templates/Invoice.docx');
    expect(templatePathFor('Invoice.docx')).toBe('Documents/Templates/Invoice.docx');
  });

  it('keeps the DOCX files of a folder listing, A to Z', () => {
    const list = customTemplatesFrom([
      { name: 'Zeta.docx', path: 'Documents/Templates/Zeta.docx', modified: 5 },
      { name: 'notes.txt', path: 'Documents/Templates/notes.txt' },
      { name: 'Sub', path: 'Documents/Templates/Sub', isDir: true },
      { name: 'alpha 2.docx', path: 'Documents/Templates/alpha 2.docx', modified: 9 },
      { name: 'alpha 10.docx', path: 'Documents/Templates/alpha 10.docx' },
    ]);
    expect(list.map((t) => t.name)).toEqual(['alpha 2', 'alpha 10', 'Zeta']);
    expect(list[2]).toEqual({ id: 'file:Documents/Templates/Zeta.docx', name: 'Zeta', path: 'Documents/Templates/Zeta.docx', modified: 5 });
    expect(customTemplatesFrom(null)).toEqual([]);
  });

  it('builds menu items after the built-in templates, with a manage entry when asked', () => {
    const picked = [];
    const templates = customTemplatesFrom([{ name: 'Invoice.docx', path: 'Documents/Templates/Invoice.docx' }]);
    const items = customTemplateItems(templates, { onPick: (id) => picked.push(id), onManage: () => picked.push('manage') });
    expect(items[0]).toEqual({ separator: true });
    expect(items[1]).toEqual({ header: 'My templates' });
    expect(items[2].label).toBe('Invoice');
    items[2].onSelect();
    items[3].onSelect();
    expect(picked).toEqual(['file:Documents/Templates/Invoice.docx', 'manage']);
    expect(customTemplateItems([], { onPick: () => {} })).toEqual([]);
    expect(customTemplateItems(templates, { onPick: () => {} })).toHaveLength(3);
  });
});

describe('template ids and paths', () => {
  it('gives a template listed from the drive root an id the app can open', () => {
    const [t] = customTemplatesFrom([{ name: 'Letter.docx', path: '/demo/AppData/app-907541aa/Documents/Templates/Letter.docx' }]);
    expect(t.id).toBe('file:Documents/Templates/Letter.docx');
    expect(t.path).toBe('/demo/AppData/app-907541aa/Documents/Templates/Letter.docx');
    expect(customTemplatePath(t.id)).toBe('Documents/Templates/Letter.docx');
  });

  it('opens only a DOCX or DOTX file inside the Templates folder, however the folder is spelled', () => {
    expect(customTemplatePath('file:Documents/Templates/Letter.docx')).toBe('Documents/Templates/Letter.docx');
    expect(customTemplatePath('file:/nj/Documents/Templates/Letter.dotx')).toBe('/nj/Documents/Templates/Letter.dotx');
    for (const outside of ['file:/etc/passwd', 'file:Documents/Report.docx', 'file:Documents/../x.docx', 'file:Documents/Templates/../Report.docx', 'file:Documents/Templates/sub/Letter.docx', 'file:Documents/Templates/notes.txt', 'file:', 'letter']) {
      expect(customTemplatePath(outside)).toBeNull();
    }
  });
});
