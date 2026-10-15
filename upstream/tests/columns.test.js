import { describe, it, expect } from 'vitest';
import { COLUMN_CHOICES, COLUMN_GAP_IN, columnCount, setColumns } from '../src/lib/columns.js';

describe('columns', () => {
  it('reads the section count with one as the default', () => {
    expect(columnCount({ columns: { count: 2, gap: 0.5 } })).toBe(2);
    expect(columnCount({ columns: { gap: 0.5 } })).toBe(1);
    expect(columnCount(null)).toBe(1);
    expect(COLUMN_CHOICES.map((c) => c.count)).toEqual([1, 2, 3]);
  });

  it('applies equal columns to every section and reports failures', async () => {
    const calls = [];
    const api = { sections: { setColumns: async (input) => { calls.push(input); return { success: true }; } } };
    const sections = [{ address: { kind: 'section', sectionId: 'a' } }, { id: 'b' }];
    expect(await setColumns(api, sections, 2)).toBe(2);
    expect(calls).toEqual([
      { target: { kind: 'section', sectionId: 'a' }, count: 2, gap: COLUMN_GAP_IN, equalWidth: true },
      { target: { kind: 'section', sectionId: 'b' }, count: 2, gap: COLUMN_GAP_IN, equalWidth: true },
    ]);
    api.sections.setColumns = async () => ({ success: false, failure: { message: 'nope' } });
    await expect(setColumns(api, sections, 3)).rejects.toThrow('nope');
    api.sections.setColumns = async () => ({ success: false, failure: { code: 'NO_OP' } });
    expect(await setColumns(api, sections, 1)).toBe(2);
  });
});
