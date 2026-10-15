// Units for word-by-word movement include trailing ordinary/NBSP spaces. Punctuation runs and
// structural breaks are separate units; apostrophes inside words are retained.
// Unicode letters/marks and surrogate pairs stay intact. This is caret movement,
// independent of line wrapping, run formatting and DOCX serialization.
export function wordPosition(text, position, direction, inclusive = false) {
  const units = /(?:[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*|[^\p{L}\p{N}\p{M} \u00a0\t\n\r\v\f\u000e\ufffc]+)[ \u00a0]*|[ \u00a0]+|[\t\n\r\v\f\u000e\ufffc]/gu;
  let previous = 0;
  for (const unit of text.matchAll(units)) {
    if (direction < 0 && unit.index >= position) return inclusive && unit.index === position ? position : previous;
    if (direction > 0 && (unit.index > position || inclusive && unit.index === position)) return unit.index;
    previous = unit.index;
  }
  return direction > 0 ? text.length : previous;
}

// Option+Arrow on macOS moves to the start of the previous word going left and
// to the end of the next word going right. Whitespace is skipped; a run of
// adjacent punctuation is one stop, as in native Mac text fields.
export function optionWordPosition(text, position, direction) {
  const units = [];
  for (const s of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
    if (!/\S/u.test(s.segment)) continue;
    const end = s.index + s.segment.length, last = units.at(-1);
    if (!s.isWordLike && last && !last.word && last.end === s.index) last.end = end;
    else units.push({ start: s.index, end, word: !!s.isWordLike });
  }
  if (direction < 0) return units.findLast(unit => unit.start < position)?.start ?? 0;
  return units.find(unit => unit.end > position)?.end ?? text.length;
}
