export class UnsupportedDocumentError extends Error {
  constructor(feature) {
    super(`This document contains ${feature}, which this first editor version cannot edit yet. The original file has not been changed.`);
    this.name = 'UnsupportedDocumentError';
    this.feature = feature;
  }
}
