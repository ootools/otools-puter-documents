import { readContextualFlag } from './docx-contextual-spacing.js';
import { UnsupportedDocumentError } from './errors.js';
export function readStrike(rPr) {
  const single = readContextualFlag(rPr, 'strike'), double = readContextualFlag(rPr, 'dstrike');
  if (single !== undefined && double !== undefined) throw new UnsupportedDocumentError('strike and dstrike on the same property set');
  return single !== undefined ? { strikethrough: single ? 'single' : 'singleOff' } : double !== undefined ? { strikethrough: double ? 'double' : 'doubleOff' } : {};
}
