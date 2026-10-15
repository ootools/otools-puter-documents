import { sectionColumnIntervals } from './section-columns.js';
import { columnFlowPage } from './column-layout.js';

// Resolve widths against actual pagination, including paragraph continuations.
// Measurements remain separate from placement: the owning layout supplies the
// remeasurement callback, and each trial owns its immutable measured blocks.
export function paginateColumnWidths(blocks, geometry, paginate, maxPages, startY, previousAfter) {
  const flow = columnFlowPage(geometry);
  if (!geometry.columns || !blocks.remeasure) return paginate(blocks, flow, maxPages, startY, previousAfter);
  const widths = sectionColumnIntervals(geometry.columns, geometry.left * 15,
    (geometry.width - geometry.left - geometry.right) * 15).map(c => (c.right-c.left)/15);
  if (widths.every(w => Math.abs(w-widths[0]) < 1e-6)) return paginate(blocks, flow, maxPages, startY, previousAfter);
  let measured = blocks;
  const signatures = new Set();
  for (let attempt = 0; attempt < maxPages * 2 + 8; attempt++) {
    const result = paginate(measured, flow, maxPages, startY, previousAfter);
    const lines = result.lines.filter(l => !l.cellId);
    if (lines.every(l => Math.abs((l.columnMeasureWidth ?? widths[0])-widths[l.page%widths.length]) < 1e-6)) return result;
    const boundaries = lines.map(l => ({ start: l.start, width: widths[l.page%widths.length] }));
    const signature = JSON.stringify(boundaries);
    if (signatures.has(signature)) throw new Error('Unequal column wrapping did not converge.');
    signatures.add(signature);
    const widthAt = offset => {
      let lo=0, hi=boundaries.length;
      while(lo<hi) { const mid=(lo+hi)>>>1; if(boundaries[mid].start<=offset)lo=mid+1;else hi=mid; }
      return boundaries[Math.max(0,lo-1)]?.width ?? widths[0];
    };
    measured = blocks.remeasure(widthAt);
  }
  throw new Error('Unequal column wrapping did not converge.');
}
