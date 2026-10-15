import { prepareLegacyGpos, prefetchLegacyGpos, legacyGposFamily } from './gpos-only-kerning.js';
import {prepareScriptFontSizes,scriptFontSizeReady} from './script-font-size.js';
import { prepareShapeAutofit } from './shape-autofit.js';
import { embeddedPreviewOnly, isEmbeddedFont } from './embedded-fonts.js';
import { embeddedFontCandidates } from './font-availability.js';
import { listMarkers } from './numbering.js';
import { text3dSurface } from './text-3d.js';
import { prepareText3dFonts } from './text-3d-fonts.js';
import { font, layoutDocument } from './layout.js';
import { fontMetrics, nativeFaceMetrics, clearNativeFaceMetrics } from './font-metrics.js';
import { pageGeometry } from './page-settings.js';
import { layoutPageStories } from './page-story-layout.js';
import { textTransform } from './text-geometry.js';
import { kerningEnabled } from './kerning.js';
import { FONT_SLOTS, textFontStyle, cssFontString } from './font-families.js';
import {literalSeparatorFamily,literalSeparatorText,prepareLiteralSeparatorDisplay,prepareLiteralSeparatorSources} from './literal-separator-display.js';
import {prepareAuthorizedLocalFonts as prepareSeparatorFontAccess,localFontVersion as separatorFontVersion} from './local-fonts.js';
import { canvasFontSources, prepareCanvasFont, checkFontAvailability, fontAvailable, displayedFont, isBundledFont } from './font-availability.js';
import { fileFontSources } from './file-fonts.js';
import { usesSyntheticBold, usesSyntheticAdvance } from './synthetic-bold.js';
import { syntheticAdvanceFamily } from './synthetic-advance.js';
import { bidiPaintText } from './bidi-text.js';
import { shapedCaretAdvances } from './shaped-carets.js';
import { outlineTextScale } from './outline-text-scale.js';
import { prepareOpenTypeKerning, requestsOpenTypeKerning, openTypeKerningFamily } from './opentype-kerning.js';

const fontAlternatives = new WeakMap();
const roundedAdvanceFaces = new Map();
const separatorRequests = new WeakMap();
const scriptRequests = new WeakMap();
export function setCanvasFontAlternatives(context, alternatives) {
  if (alternatives) fontAlternatives.set(context, alternatives); else fontAlternatives.delete(context);
}
export const renderedStyle = (context, style) => {
  const family = displayedFont(style, fontAlternatives.get(context));
  return family === (style.fontFamily || style.fontAscii || 'Noto Sans') ? style : { ...style, fontFamily: family };
};
export const canvasSyntheticBold = (context, style) => usesSyntheticBold(style, displayedFont(style, fontAlternatives.get(context)));
export const canvasSyntheticAdvanceFamily = (context, style) => {
  const family = displayedFont(style, fontAlternatives.get(context));
  return usesSyntheticAdvance(style, family) ? legacyGposFamily({ ...style, fontFamily: family }, true) || openTypeKerningFamily({ ...style, fontFamily: family }, true) || syntheticAdvanceFamily(family, style.italic) : undefined;
};

// Bitmap strikes expose pixel-rounded advances at some native font sizes.
// Probe once per face/size, without kerning or spacing, and confirm that the
// outline advances differ. Fractional outline faces keep their existing paint.
export function usesRoundedFontAdvances(context, style) {
  style = renderedStyle(context, style);
  if (isBundledFont(style.fontFamily || style.fontAscii || 'Noto Sans')) return false;
  const key = font(style);
  if (roundedAdvanceFaces.has(key)) return roundedAdvanceFaces.get(key);
  const probe = { ...style, kerning: 0, ligatures: 'none', characterSpacing: 0, justificationSpacing: 0 };
  context.save();
  let rounded = false;
  try {
    setCanvasTextStyle(context, probe);
    const widths = [...'iMW0.'].map(text => context.measureText(text).width);
    if (widths.every(width => Number.isFinite(width) && Math.abs(width - Math.round(width)) < 1e-7)) {
      const scaled = outlineTextScale(probe);
      setCanvasTextStyle(context, scaled.style);
      const outline = context.measureText('iMW0.').width / scaled.factor;
      rounded = Math.abs(outline - widths.reduce((a,b)=>a+b,0)) > 1 / 64;
    }
  } finally { context.restore(); }
  roundedAdvanceFaces.set(key, rounded);
  return rounded;
}

// A font-encoded numbering glyph and its Unicode fallback are not interchangeable.
// Use the original glyph only with its own available font, in both paint/measure.
export function canvasText(context, text, style) {
  const symbol = style.symbol;
  const family = displayedFont(style, fontAlternatives.get(context));
  const matches = symbol && (family.toLowerCase() === symbol.font.trim().toLowerCase() ||
    (isEmbeddedFont(family) || fileFontSources(family)) && family === displayedFont({ fontFamily: symbol.font }, fontAlternatives.get(context)));
  const painted=bidiPaintText(symbol && text === symbol.fallback && matches ? symbol.text : text.replaceAll('\u00a0', ' '), style);
  return painted.includes('\u2028')?literalSeparatorText(painted,selectedCanvasFamily(context,renderedStyle(context,style))):painted;
}

function selectedCanvasFamily(context,style){
 return canvasSyntheticAdvanceFamily(context,style)||legacyGposFamily(style)||openTypeKerningFamily(style)||style.fontFamily||style.fontAscii||'Noto Sans';
}

export function canvasLetterSpacing(style) {
  // Spacing is an absolute page distance, even when glyph widths or scripts are scaled.
  return (style.characterSpacing || 0) * 4 / 3 / (textTransform(style)?.scaleX || 1);
}
export const canvasWordSpacing = style => (style.justificationSpacing || 0) / (textTransform(style)?.scaleX || 1);
export function setCanvasTextStyle(context, style) {
  if (!context) throw new Error('Canvas 2D is unavailable in this browser.');
  style = renderedStyle(context, style);
  const selected=selectedCanvasFamily(context,style);
  const separatorFamily=literalSeparatorFamily(selected);
  const nativeFont=font(selected === (style.fontFamily||style.fontAscii||'Noto Sans') ? style : { ...style, fontFamily: selected });
  const primary=isBundledFont(selected)?'"Canvas Noto Sans"':cssFontString(selected);
  // Keep the real family first: the private face supplies only the absent alias.
  context.font=separatorFamily?nativeFont.replace(primary,()=>`${primary}, ${cssFontString(separatorFamily)}`):nativeFont;
  // Canvas defaults to standard ligatures; DOCX defaults to none. Explicit
  // fontKerning below retains the independent run kerning threshold.
  if ('textRendering' in context) context.textRendering = style.ligatures === 'none' ? 'optimizeSpeed' : 'auto';
  context.direction = style.bidiDirection || 'ltr';
  if (!('fontKerning' in context)) throw new Error('This browser cannot control font kerning. Open the document in a browser with Canvas font-kerning support.');
  context.fontKerning = kerningEnabled(style) ? 'normal' : 'none';
  if ('letterSpacing' in context) context.letterSpacing = `${canvasLetterSpacing(style)}px`;
  else if (style.characterSpacing) throw new Error('This browser cannot display character spacing. Open the document in a browser with Canvas letter-spacing support.');
  if ('wordSpacing' in context) context.wordSpacing = `${canvasWordSpacing(style)}px`;
  else if (style.justificationSpacing) throw new Error('This browser cannot display justified text. Open the document in a browser with Canvas word-spacing support.');
}

export function validateCanvasTextSupport(pkg) {
  const context = document.createElement('canvas').getContext('2d');
  setCanvasTextStyle(context, {});
  const spaced = pkg.paragraphs.some(p => p.markFormat?.characterSpacing || p.runs.some(r => r.characterSpacing)) || listMarkers(pkg.paragraphs, pkg.numbering).some(m => m?.level.markerStyle.characterSpacing);
  if (spaced) setCanvasTextStyle(context, { characterSpacing: 1 });
  if (pkg.paragraphs.some(p => p.format?.alignment === 'both')) setCanvasTextStyle(context, { justificationSpacing: 1 });
}

function canvasFontRequirements(pkg) {
  const textEffects = new Map();
  const scriptNames=new Set();
  const separatorStyles=[];
  const legacyGposNames = new Set(), recoveryNames = new Set();
  const names = new Set(), openTypeNames = new Set(), collect = style => {
    if(style?.text?.includes('\u2028'))separatorStyles.push(textFontStyle('\u2028',style));
    for (const key of Object.keys(FONT_SLOTS)) if (style?.[key]) {
      names.add(style[key]);
      if(style.verticalAlign&&style.verticalAlign!=='baseline')scriptNames.add(style[key]);
      if (!pkg.styles?.openTypeFeatures && style.kerning > 0) legacyGposNames.add(style[key]);
      if (pkg.styles?.openTypeFeatures && requestsOpenTypeKerning(style)) openTypeNames.add(style[key]);
      if (pkg.styles?.openTypeFeatures && style.kerning > 0 && !requestsOpenTypeKerning(style)) recoveryNames.add(style[key]);
    }
    if (style?.bodySymbol) names.add(style.bodySymbol.font);
    if (style?.text3d && text3dSurface(style)) {
      for (const slot of Object.keys(FONT_SLOTS)) if (style[slot]) {
        const family = style[slot];
        textEffects.set(`${family}/${!!style.bold}/${!!style.italic}`, { ...style, fontFamily: family });
      }
    }
  };
  const paragraphs = ps => { for (const p of ps || []) { collect(p.markFormat); p.runs.forEach(collect); } };
  paragraphs(pkg.paragraphs);
  for (const story of Object.values(pkg.pageStories?.stories || {})) paragraphs(story.paragraphs);
  collect(pkg.styles?.defaults?.run);
  for (const style of Object.values(pkg.styles?.definitions || {})) collect(style.run);
  for (const marker of listMarkers(pkg.paragraphs, pkg.numbering)) collect(marker?.level.markerStyle);
  const scene = node => { if (node.text) paragraphs(node.text.paragraphs); node.children?.forEach(scene); };
  for (const asset of Object.values(pkg.assets || {})) {
    if (asset.scene) scene(asset.scene);
    if (asset.chart) for (const style of [asset.chart.title?.style, asset.chart.text, asset.chart.categoryAxis?.text, asset.chart.valueAxis?.text, asset.chart.legendText]) collect(style);
    if (asset.chart?.title?.paragraphs) for (const p of asset.chart.title.paragraphs) for (const r of p.runs) collect(r.style);
  }
  return {textEffects,separatorStyles,legacyGposNames,recoveryNames,names,openTypeNames,scriptNames};
}

export async function loadCanvasFonts(pkg) {
  if (!document.fonts) return;
  const requirements=pkg?canvasFontRequirements(pkg):undefined;
  // Prepare unregistered faces alongside the mandatory fallback-font load.
  // Registration still waits for native family and synthetic-face selection.
  const legacySourceJobs=new Map();
  const legacyQueue=[...new Map([...(requirements?.legacyGposNames || []), ...(requirements?.recoveryNames || [])]
    .map(name=>[name.trim().toLowerCase(),name])).values()];
  const legacySources=Promise.all(Array.from({length:Math.min(4,legacyQueue.length)},async()=>{
    while(legacyQueue.length){
      const name=legacyQueue.pop(),recoveryOnly=!!pkg?.styles?.openTypeFeatures;
      try {
        await checkFontAvailability(name);
        if(fontAvailable(name)!==true)continue;
        const job=prefetchLegacyGpos(name,canvasFontSources(name),recoveryOnly);
        legacySourceJobs.set(name.trim().toLowerCase(),job);
        if(job)await job.promise;
      } catch { /* Optional correction keeps the selected font on failure. */ }
    }
  }));
  // Settle an existing grant before caching font preparation. Late enumeration
  // would invalidate every prepared face when a document first uses scripts.
  const separatorAccess=requirements&&(requirements.separatorStyles.length||requirements.scriptNames.size)?prepareSeparatorFontAccess():undefined;
  const separatorSources=separatorAccess?.then(()=>prepareLiteralSeparatorSources(requirements.separatorStyles));
  const fonts = ['normal 400', 'normal 700', 'italic 400', 'italic 700'].map(face => `${face} 16px "Canvas Noto Sans"`);
  await Promise.all(fonts.map(face => document.fonts.load(face)));
  if (!fonts.every(face => document.fonts.check(face))) throw new Error('The document font could not load. Reload to try again.');
  if (pkg) {
    if(separatorAccess)await separatorAccess;
    const {textEffects,separatorStyles,legacyGposNames,recoveryNames,names,openTypeNames,scriptNames}=requirements;
    const embedded = await embeddedFontCandidates(pkg.styles?.fontAlternatives, names);
    for (const alternate of Object.values(pkg.styles?.fontAlternatives || {}).flat()) if (!isEmbeddedFont(alternate) || embedded.has(alternate)) names.add(alternate);
    // Resolve display families first, then overlap metadata reads with font probes.
    if(scriptNames.size)await Promise.all([...names].map(checkFontAvailability));
    const scriptFonts=prepareScriptFontSizes(scriptNames,pkg.styles?.fontAlternatives);
    const separatorJobs=[];
    const queue = [...names];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const name=queue.pop();
        if(separatorStyles.length){
          await checkFontAvailability(name);
          if(fontAvailable(name)===true)for(const style of separatorStyles){
            if((style.fontFamily||style.fontAscii||'Noto Sans').trim().toLowerCase()===name.trim().toLowerCase())
              separatorJobs.push(prepareLiteralSeparatorDisplay(style,pkg.styles?.fontAlternatives));
          }
        }
        await prepareCanvasFont(name);
      }
    }));
    if (textEffects.size) await prepareText3dFonts([...textEffects.values()], pkg.styles?.fontAlternatives);
    await scriptFonts;
    if(separatorSources)await Promise.all([separatorSources,...separatorJobs]);
    const kerningNames = new Set([...openTypeNames].map(fontFamily => displayedFont({ fontFamily }, pkg.styles?.fontAlternatives)));
    await Promise.all([...kerningNames].map(prepareOpenTypeKerning));
    await legacySources;
    const gposFamilies = new Set([...legacyGposNames].map(fontFamily => displayedFont({ fontFamily }, pkg.styles?.fontAlternatives)));
    await Promise.all([...gposFamilies].map(async name => prepareLegacyGpos(name, canvasFontSources(name), await legacySourceJobs.get(name.trim().toLowerCase()))));
    const recoveredFamilies = new Set([...recoveryNames].map(fontFamily => displayedFont({ fontFamily }, pkg.styles?.fontAlternatives)));
    await Promise.all([...recoveredFamilies].map(async name => prepareLegacyGpos(name, canvasFontSources(name), await legacySourceJobs.get(name.trim().toLowerCase()), true)));
    if(separatorStyles.length)await Promise.all(separatorStyles.map(style=>prepareLiteralSeparatorDisplay(style,pkg.styles?.fontAlternatives)));
    if (pkg.parts && !pkg.readOnly && [...embedded].some(alias => displayedFont({ fontFamily: alias }) === alias && embeddedPreviewOnly(alias))) {
      pkg.readOnly = true;
      pkg.previewIssues = [...(pkg.previewIssues || []), 'Embedded fonts permit preview and printing only.'];
    }
  }
  clearNativeFaceMetrics();
  roundedAdvanceFaces.clear();
}

export function measureCanvasText(context, text, style, onSeparatorReady) {
  style = renderedStyle(context, style);
  if(onSeparatorReady&&style.verticalAlign&&style.verticalAlign!=='baseline'&&!scriptFontSizeReady(style)){
    let requested=scriptRequests.get(context);if(!requested)scriptRequests.set(context,requested=new Set());
    const id=JSON.stringify([style.fontFamily,separatorFontVersion()]);
    if(!requested.has(id)){
      requested.add(id);
      void prepareScriptFontSizes(new Set([style.fontFamily])).then(onSeparatorReady);
    }
  }
  if(onSeparatorReady&&text.includes('\u2028')&&!literalSeparatorFamily(selectedCanvasFamily(context,style))){
    let requested=separatorRequests.get(context);if(!requested)separatorRequests.set(context,requested=new Set());
    const id=JSON.stringify([font(style),style.legacyKerning,style.ligatures,style.kerning,separatorFontVersion()]);
    if(!requested.has(id)){requested.add(id);void prepareLiteralSeparatorDisplay(style).then(changed=>{if(changed)onSeparatorReady();});}
  }

  // One shaping call at outline scale avoids bitmap advances and fractional
  // CSS-em truncation, retaining authored spacing and line-box metrics.
  const outlined = usesRoundedFontAdvances(context, style);
  let { factor: scale, style: measuredStyle } = outlined ? outlineTextScale(style) : {factor:1,style};
  if (scale === 1) {
    const em = (style.fontSize ?? 12) * 4 / 3, aligned = Math.ceil((em - 1e-8) * 100) / 100;
    scale = aligned / em;
    if (Math.abs(scale - 1) >= 1e-10) measuredStyle = {
      ...style, fontSize: (aligned + Math.max(1e-6, aligned * 1e-7)) * .75,
      characterSpacing: (style.characterSpacing || 0) * scale,
      justificationSpacing: (style.justificationSpacing || 0) * scale,
      kerning: kerningEnabled(style) ? style.kerning * scale : 0,
    };
  }
  if(measuredStyle!==style&&style.verticalAlign&&style.verticalAlign!=='baseline')measuredStyle.scriptReferenceSize=style.scriptReferenceSize??style.fontSize??12;
  if (outlined) context.save();
  setCanvasTextStyle(context, measuredStyle);
  const displayedText=canvasText(context,text,style);
  const native = context.measureText(displayedText);
  const face = !isBundledFont(displayedFont(style)) && Number.isFinite(native.fontBoundingBoxAscent)
    ? nativeFaceMetrics(font({ ...style, fontSize: 1536 }), displayedFont(style), style) : undefined;
  const box = measuredStyle === style ? native : {
    fontBoundingBoxAscent: native.fontBoundingBoxAscent / scale,
    fontBoundingBoxDescent: native.fontBoundingBoxDescent / scale,
  };
  const caretGlyphs = style.caretOffsets ? text.replaceAll('\u00a0', ' ') : text;
  const caretText=style.caretOffsets&&caretGlyphs.includes('\u2028')?literalSeparatorText(caretGlyphs,selectedCanvasFamily(context,style)):caretGlyphs;
  const caretAdvances=style.caretOffsets && shapedCaretAdvances(context,caretText,style.caretOffsets,native.width / scale);
  if (outlined) context.restore();
  const result = { width: native.width / scale, ...fontMetrics(style, box, face), ...(caretAdvances ? {caretAdvances} : {}) };
  if(style.verticalAlign&&style.verticalAlign!=='baseline')result.scriptTransform=textTransform(style);
  return result;
}

// Import can fail on geometry only discoverable after native font measurement.
// Run that validation before replacing the local playground's current editor.
export async function validateCanvasLayout(pkg) {
  validateCanvasTextSupport(pkg); await loadCanvasFonts(pkg);
  const context = document.createElement('canvas').getContext('2d');
  setCanvasFontAlternatives(context, pkg.styles?.fontAlternatives);
  const measure = (text, style) => measureCanvasText(context, text, style);
  const { assets, drawingLayouts, autofitApproximations } = prepareShapeAutofit(pkg.assets, measure, { bestEffort: pkg.readOnly });
  const body = layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { ...(!pkg.readOnly ? { styles: pkg.styles } : {}), drawingLayouts, bestEffort: pkg.readOnly });
  if (pkg.pageStories && !pkg.readOnly) layoutPageStories(body, pkg.pageStories, [...pkg.paragraphs.filter(p => p.sectionEnd).map(p => p.sectionEnd), pkg.pageSettings], measure, pkg.numbering, { styles: pkg.styles, drawingLayouts });
  // A later layout failure must not leave fitted scenes in the package that
  // the read-only retry will receive. Publish only a successful preparation.
  Object.assign(pkg, { assets, drawingLayouts });
  const approximations = [...autofitApproximations, ...(body.floatingTableApproximations || []), ...(body.frameApproximations || []), ...(body.alignmentApproximations || []), ...(body.numberingApproximations || []), ...(body.tableColumnApproximations || []), ...(body.rotatedCellApproximations || []), ...(body.negativeWrapApproximations || []), ...(body.manualBreakWrapApproximations || [])];
  if (approximations.length) {
    const issues = new Set(pkg.previewIssues || []);
    for (const approximation of approximations) {
      issues.delete(approximation.reason);
      issues.add(approximation.message);
    }
    pkg.previewIssues = [...issues];
  }
  return { body, layoutOf(model) {
    const next = layoutDocument(model.paragraphs, measure, pageGeometry(model.pageSettings), model.numbering, model.tables, pkg.pageStories, { styles: model.styles, drawingLayouts });
    if (pkg.pageStories) layoutPageStories(next, pkg.pageStories, [...model.paragraphs.filter(p => p.sectionEnd).map(p => p.sectionEnd), model.pageSettings], measure, model.numbering, { styles: model.styles, drawingLayouts });
    return next;
  } };
}
