import { UnsupportedDocumentError } from './errors.js';

// Display spacing only: source text and run properties never acquire this value.
// Native Canvas word-spacing expands U+0020 and U+00A0 without breaking shaping.
export const justificationSpace = text => text === ' ' || text === '\u00a0';
export function checkJustificationText(text, alignment) {
  if (alignment === 'both' && /\p{Script=Arabic}/u.test(text)) throw new UnsupportedDocumentError('Arabic kashida justification');
}

export function justificationRange(span, measured, right, tab) {
  let first = span.findLastIndex(c => c.text === '\t') + 1, last = span.length;
  while (first < last && (span[first].ignoredCellBreak || justificationSpace(span[first].text))) first++;
  while (last > first && (span[last - 1].ignoredCellBreak || justificationSpace(span[last - 1].text))) last--;
  const gaps = span.slice(first, last).filter(c => justificationSpace(c.text)).length;
  const extra = right - measured.stops.at(-1).x + measured.ignoredTrailingWidth;
  if (!gaps || extra <= 1e-6) return null;
  // Earlier fields stay anchored. Justification can expand the final left tab
  // field; other tab alignments require a separate compatible algorithm.
  if (tab && tab.alignment !== 'left') throw new UnsupportedDocumentError('justification after center, right or decimal tabs');
  return { first, last, gaps, spacing: extra / gaps };
}
