import { parseXml } from './docx-xml.js';
import { UnsupportedDocumentError } from './errors.js';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

// Resolve a singleton internal relationship from the supported main-document
// location. Per OPC, its base is the source part, not its Relationships part.
export function relatedPartPath(parts, kind, relationshipType = OFFICE_REL + kind) {
  const rels = parts['word/_rels/document.xml.rels'] ? parseXml(parts['word/_rels/document.xml.rels']) : null;
  const links = [...(rels?.documentElement.children || [])].filter(n => n.namespaceURI === REL && n.localName === 'Relationship' && n.getAttribute('Type') === relationshipType);
  if (!links.length) return null;
  if (links.length !== 1 || ![null, 'Internal'].includes(links[0].getAttribute('TargetMode'))) throw new UnsupportedDocumentError(`duplicate or external ${kind} relationships`);
  const target = links[0].getAttribute('Target');
  if (!target || /[\\?#:\s]/.test(target) || target.startsWith('//') || /%(?![0-9a-f]{2})|%2f|%5c/i.test(target)) throw new UnsupportedDocumentError(`an invalid ${kind} target`);
  const path = [];
  for (const segment of (target.startsWith('/') ? target.slice(1) : 'word/' + target).split('/')) {
    if (segment === '..') path.pop();
    else if (segment !== '.') { if (!segment) throw new UnsupportedDocumentError(`an invalid ${kind} target`); path.push(segment); }
  }
  const name = path.join('/');
  if (!Object.hasOwn(parts, name)) throw new UnsupportedDocumentError(`a missing ${kind} part`);
  return name;
}
