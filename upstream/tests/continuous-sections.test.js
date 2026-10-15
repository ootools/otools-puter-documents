import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, hitTest, verticalLine } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom=new JSDOM(); globalThis.DOMParser=dom.window.DOMParser; globalThis.XMLSerializer=dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });

const names = ['balanced', 'explicit', 'overflow', 'one', 'table', 'keep', 'stories', 'full', 'tight', 'stories-overflow'];
for (const name of names) it(`matches the native reference continuous-section flow and preserves edits: ${name}`, async () => {
 const folder='tests/fixtures/continuous-sections/';
 const ref=JSON.parse(readFileSync(folder+name+'-reference.json'));
 const pkg=await DocxPackage.open(readFileSync(folder+name+'.docx'));
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const geometry=()=>layoutDocument(doc.paragraphs,text=>({width:text.length*6,ascent:12.8,descent:3.2}),pageGeometry(doc.pageSettings),doc.numbering,doc.tables);
 const layout=geometry(), lines=layout.lines.filter(l=>l.fragments.some(f=>f.text.trim()));
 const expected=ref.lines.filter(l=>!l.text.startsWith('Header'));
 expect(layout.pageCount).toBe(ref.pages);expect(lines).toHaveLength(expected.length);
 expected.forEach((e,i)=>{
  const line=lines[i];expect(line.fragments.map(f=>f.text).join('')).toBe(e.text);
  expect(line.page).toBe(e.page);expect(Math.abs(line.stops[0].x*.75-e.x)).toBeLessThan(.15);
  expect(hitTest(layout,line.page,line.stops[0].x+.1,line.y+line.height/2)).toBe(line.start);
 });
 expect(layout.pageRegions[name==='full'?1:0].length).toBeGreaterThan(1);
 const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(pkg.parts);
 doc.select(0);doc.replace('X');expect(geometry().pageCount).toBe(ref.pages);
 const edited=await save(),parts=unzipSync(edited),reopened=await DocxPackage.open(edited);
 expect(new TextDocument(reopened.paragraphs,reopened.pageSettings,reopened.numbering,reopened.styles,reopened.tables,reopened.assets).text).toBe(doc.text);
 for(const key of Object.keys(pkg.parts))if(key!=='word/document.xml')expect(parts[key],key).toEqual(pkg.parts[key]);
 expect(reopened.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionEnd.sectionType)).toEqual(['nextPage','continuous']);
 expect(reopened.pageSettings.sectionType).toBe('continuous');
 doc.undo();expect(unzipSync(await save())).toEqual(pkg.parts);
});

it('keeps vertical navigation in source order when an unbalanced final column is shorter', async () => {
 const pkg=await DocxPackage.open(readFileSync('tests/fixtures/continuous-sections/overflow.docx'));
 const paragraphs=structuredClone(pkg.paragraphs.slice(0,-1));
 const settings=paragraphs.at(-1).sectionEnd;
 delete paragraphs.at(-1).sectionEnd;delete paragraphs.at(-1).sectionProperties;
 const layout=layoutDocument(paragraphs,text=>({width:text.length*6,ascent:12.8,descent:3.2}),pageGeometry(settings),pkg.numbering,pkg.tables);
 const lines=layout.lines.filter(line=>!line.virtual && line.fragments.some(f=>f.text.trim()));
 expect(layout.pageRegions[0].length).toBe(2);
 for(let i=0;i<lines.length-1;i++)expect(verticalLine(layout,lines[i],1,lines[i].stops[0].x)?.start).toBe(lines[i+1].start);
});
