// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {wordPosition,optionWordPosition} from '../src/engine/word-navigation.js';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
const root='tests/fixtures/native-navigation/';
const reference=JSON.parse(readFileSync(root+'native-ranges.json','utf8').replace(/^\uFEFF/,''));
const texts=JSON.parse(readFileSync(root+'cases.json','utf8'));
const source=readFileSync(root+'control.docx');
it('binds authored source and visible text to unchanged native reference range captures',async()=>{
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 expect(reference).toMatchObject({savedBefore:true,savedAfter:true,sourceUnchanged:true});
 expect(reference.text).toBe(texts.join('\r')+'\r');
 const pkg=await DocxPackage.open(new Uint8Array(source)),doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 expect(doc.text).toBe(texts.join('\n'));
});
it('matches native word movement at every captured UTF-16 position in both directions',()=>{
 const text=texts.join('\n');
 const failures=[];
 for(const row of reference.positions)for(const move of row.moves){
  const actual=wordPosition(text,row.position,move.direction),expected=Math.min(text.length,move.position);
  if(actual!==expected)failures.push({position:row.position,direction:move.direction,expected,actual});
 }
 expect(failures).toEqual([]);
});
it('collapses a text selection to its containing word boundary without taking another unit',()=>{
 const text=texts.join('\n');
 for(const move of reference.selections){
  const edge=move.direction<0?move.start:move.end;
  expect(wordPosition(text,edge,move.direction,true)).toBe(move.position);
 }
});
it('moves Option word steps to word starts going left and word ends going right',()=>{
 const walk=(text,from,direction)=>{const stops=[];let at=from;while(direction<0?at>0:at<text.length){at=optionWordPosition(text,at,direction);stops.push(at);}return stops;};
 const text='Hello brave, new world. Second sentence here.';
 expect(walk(text,text.length,-1)).toEqual([44,40,31,24,22,17,13,11,6,0]);
 expect(walk(text,0,1)).toEqual([5,11,12,16,22,23,30,39,44,45]);
 // Adjacent punctuation is one stop; whitespace, tabs and paragraph breaks are skipped.
 const marks='Wait... what?!\nNext\tline';
 expect(walk(marks,marks.length,-1)).toEqual([20,15,12,8,4,0]);
 expect(walk(marks,0,1)).toEqual([4,7,12,14,19,24]);
 expect(optionWordPosition("It's done",0,1)).toBe(4);
});
