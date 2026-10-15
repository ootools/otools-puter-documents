// A one-device-pixel white surround keeps the existing blue insertion caret
// visible on dark shading and artwork without reading back the painted canvas.
// This is an editing overlay, independent of document ink and export geometry.
export function paintInsertionCaret(ctx, caret, scale, clip) {
  const width = caret.width ?? 1.5;
  if (!(width > 0 && caret.height > 0)) return;
  const edge = 1 / scale;
  ctx.save();
  if (clip) {
    ctx.beginPath(); ctx.rect(clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top); ctx.clip();
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(caret.x - edge, caret.y - edge, width + 2 * edge, caret.height + 2 * edge);
  ctx.fillStyle = '#375f91';
  ctx.fillRect(caret.x, caret.y, width, caret.height);
  ctx.restore();
}
