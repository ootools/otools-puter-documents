import { pageStoryPath } from './page-stories.js';
import { measurePageStory } from './page-story-measure.js';
import { referencePageGeometry } from './page-settings.js';

export function sectionStoryBounds(page, definition, sectionIndex, section, measure, numbering, options) {
  page = referencePageGeometry(page);
  const heights = new Map();
  return localPage => {
    const pageNumber = section.firstNumber + localPage;
    let top = page.top, bottom = page.height - page.bottom;
    for (const kind of ['header', 'footer']) {
      if (kind === 'header' ? page.fixedTop : page.fixedBottom) continue;
      if (!definition.sections[sectionIndex]?.[kind]) continue;
      const path = pageStoryPath(definition, sectionIndex, kind, pageNumber, localPage === (section.firstPage || 0)), story = path && definition.stories[path];
      if (!story?.paragraphs?.length) continue;
      const hasPage = story.paragraphs.some(p => p.runs.some(r => r.field?.type === 'PAGE'));
      const key = `${kind}/${path}/${hasPage ? pageNumber : ''}`;
      if (!heights.has(key)) {
        try {
          const { placed, trim } = measurePageStory(story, { ...page, storyKind: kind }, measure, numbering,
            { pageNumber, pageCount: options.pageCount || 1, sectionPageCount: options.sectionCounts?.[sectionIndex] || 1, pageNumbering: definition.sections[sectionIndex].pageNumbering },
            { styles: options.styles, drawingLayouts: options.drawingLayouts, onUnsupported: options.bestEffort ? () => {} : undefined });
          heights.set(key, placed.endY - trim);
        } catch (error) { if (!options.bestEffort) throw error; heights.set(key, 0); }
      }
      if (kind === 'header') top = Math.max(top, (page.header || 0) + heights.get(key));
      else bottom = Math.min(bottom, page.height - (page.footer || 0) - heights.get(key));
    }
    if (bottom <= top) throw new Error('The selected header and footer leave no writing space on this page.');
    return { top, bottom };
  };
}
