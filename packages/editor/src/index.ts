/** The editor's model: React-free, so it runs in workers and tests. */
export {
  EditorError,
  createItem,
  deleteItem,
  duplicateItem,
  putAsset,
  referencesTo,
  removeAsset,
  renameItem,
  updateItem,
  updateManifest,
  type Command,
} from './commands.js';
export {
  KIND_FOLDERS,
  decodeText,
  defaultPath,
  encodeText,
  itemKey,
  itemsOfKind,
  openProject,
  projectFiles,
  splitKey,
  type Files,
  type OpenIssue,
  type OpenResult,
  type Project,
} from './project.js';
export { EditorStore, type HistoryEntry } from './store.js';
export { directoryStore, type DirectoryHandleLike, type FileHandleLike } from './stores/fsa.js';
export { indexedDbLibrary, type ProjectInfo, type ProjectLibrary } from './stores/indexeddb.js';
export { fileSource, memoryStore, readAll, saveProject, type ProjectStore } from './stores/store.js';
export { unzipFiles, zipFiles } from './stores/zip.js';
export { TEMPLATES, blankProject, newItem, type TemplateBoard } from './templates.js';
export { editorOps, validateProject, type ProjectIssue } from './validate.js';
