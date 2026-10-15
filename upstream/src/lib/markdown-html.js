import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { toHast } from 'mdast-util-to-hast';
import { toHtml } from 'hast-util-to-html';

/** Markdown (with GitHub tables, task lists and strikethrough) as HTML. Raw HTML in the source is left out. */
export function markdownHtml(source) {
  const tree = fromMarkdown(String(source ?? ''), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  return toHtml(toHast(tree));
}
