// Application resource ceiling, measured in the editor's UTF-16 positions.
// Shared by import, mutations and search so a loaded document remains editable.
export const MAX_DOCUMENT_CHARACTERS = 5_000_000;
export const DOCUMENT_CHARACTER_LIMIT_MESSAGE = 'This editor currently supports up to 5,000,000 characters.';
