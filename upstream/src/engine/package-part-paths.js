// OPC relationship targets are relative to the owning part, not the package's
// main document. Keep names encoded as stored in the ZIP; do not URL-decode them.
function segments(path) {
  if (typeof path !== 'string' || !path || /[\\?#\u0000]/.test(path)) throw new Error('Invalid package part path.');
  const result = path.split('/');
  if (result.some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Invalid package part path.');
  return result;
}

export function relationshipPartPath(sourcePart) {
  const path = segments(sourcePart), file = path.pop();
  return [...path, '_rels', file + '.rels'].join('/');
}

export function relativePartTarget(sourcePart, targetPart) {
  const from = segments(sourcePart), to = segments(targetPart);
  from.pop();
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].join('/');
}
