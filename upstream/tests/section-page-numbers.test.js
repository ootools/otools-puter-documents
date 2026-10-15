import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { parseXml } from '../src/engine/docx-xml.js';
import { layoutDocument, MAX_PAGES } from '../src/engine/layout.js';
import { layoutPageStories } from '../src/engine/page-story-layout.js';
import { pageGeometry, DEFAULT_PAGE_SETTINGS } from '../src/engine/page-settings.js';
import { readPageNumbering, pageNumberSequence, formatPageNumber } from '../src/engine/page-numbering.js';
import { pageFieldValue } from '../src/engine/docx-page-fields.js';
import { paragraph } from '../src/engine/model.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const reference=JSON.parse(readFileSync('tests/fixtures/section-page-numbers/reference.json','utf8'));
const measure=text=>({width:text.length*7,ascent:12,descent:4});
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());

for(const [name,ref] of Object.entries(reference)) it(`matches the native reference section counts, formats, parity and blank pages: ${name}`,async()=>{
  const source=readFileSync(`public/fixtures/${name}.docx`),pkg=await DocxPackage.open(source);
  const body=layoutDocument(pkg.paragraphs,measure,pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,pkg.pageStories);
  const settings=[...pkg.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionEnd),pkg.pageSettings];
  const stories=layoutPageStories(body,pkg.pageStories,settings,measure,pkg.numbering);
  expect(body.pageCount).toBe(ref.pages.length);expect(stories.unsupported).toEqual([]);
  const pageText=(lines,i)=>lines.filter(l=>l.page===i).map(l=>l.fragments.map(f=>f.text).join('')).join('\n').trim()||null;
  ref.pages.forEach((p,i)=>{
    expect(pageText(stories.lines,i),`footer ${i+1}`).toBe(p.footer);
    expect(pageText(body.lines,i),`body ${i+1}`).toBe(p.body);
    if(p.body===null) expect(body.pageSections[i]).toBeNull();
  });
  expect(pkg.parts).toEqual(unzipSync(source));
  expect(pkg.readOnly).toBeFalsy();
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(source));
});

it('keeps continuation distinct from a repeated restart, including zero and filler pages',()=>{
  expect(pageNumberSequence([0,0,null,1,1,2],{sections:[{pageNumbering:{start:0}},{pageNumbering:{start:7}},{}]})).toEqual([0,1,null,7,8,9]);
  expect(pageFieldValue({type:'NUMPAGES'},{pageCount:12,pageNumbering:{format:'lowerRoman'}})).toBe('12');
  expect(pageFieldValue({type:'PAGE',locked:true},{pageNumber:12,pageNumbering:{format:'lowerRoman'}})).toBeNull();
  expect(formatPageNumber(0,'lowerRoman')).toBe(' ');expect(formatPageNumber(0,'upperLetter')).toBe(' ');
});

it.each(['w:start="-1"','w:start="1.5"','w:start="2147483648"','w:start="NaN"','w:unknown="1"'])('guards malformed or out-of-range page numbering: %s',attrs=>{
  const root=parseXml(`<w:sectPr xmlns:w="${W}"><w:pgNumType ${attrs}/></w:sectPr>`).documentElement;
  expect(()=>readPageNumbering(root)).toThrow();
});

it('guards duplicate numbering declarations and bounded numeral expansion',()=>{
  const root=parseXml(`<w:sectPr xmlns:w="${W}"><w:pgNumType/><w:pgNumType/></w:sectPr>`).documentElement;
  expect(()=>readPageNumbering(root)).toThrow(/invalid/);
  expect(()=>formatPageNumber(2147483647,'upperLetter')).toThrow(/limit/);
  expect(()=>formatPageNumber(2147483647,'lowerRoman')).toThrow(/limit/);
});

it('retains cached unsupported PAGE formats without hiding ordinary story text or count fields',()=>{
  const p=paragraph('body'),settings=DEFAULT_PAGE_SETTINGS;
  const definition={sections:[{header:{},footer:{default:'f'},pageNumbering:{format:'ordinal'}}],stories:{f:{paragraphs:[paragraph('',{runs:[{text:'Page '},{text:'?',field:{type:'PAGE',cachedText:'first'}},{text:' of '},{text:'?',field:{type:'NUMPAGES',cachedText:'99'}}]})]}}};
  const body=layoutDocument([p],measure,pageGeometry(settings));
  const result=layoutPageStories(body,definition,[settings],measure,undefined,{bestEffort:true});
  expect(result.lines[0].fragments.map(f=>f.text).join('')).toBe('Page first of 1');
  expect(result.unsupported).toHaveLength(1);
});

it('includes inserted filler pages in the existing page resource limit',()=>{
  const settings=DEFAULT_PAGE_SETTINGS;
  const paragraphs=Array.from({length:MAX_PAGES},(_,i)=>paragraph('Body',{...(i<MAX_PAGES-1?{sectionEnd:settings}:{})}));
  const definition={evenAndOdd:true,sections:paragraphs.map(()=>({pageNumbering:{start:1}}))};
  expect(()=>layoutDocument(paragraphs,measure,pageGeometry(settings),undefined,[],definition)).toThrow(/supports up to/);
});
