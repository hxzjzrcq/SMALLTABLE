import { bytes } from '../shared/model';
import { DEFAULT_CAPABILITIES } from '../shared/limits';
export const NOTES_KEY = 'smalltable.private-notes.v1';
export interface NotesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function readNotes(storage: NotesStorage) {
  return storage.getItem(NOTES_KEY) ?? storage.getItem('tabletop.private-notes.v1') ?? '';
}
export function writeNotes(
  storage: NotesStorage,
  value: string,
  max = DEFAULT_CAPABILITIES.maxNotesBytes,
) {
  if (bytes(value) > max) throw Error(`超过 ${max} 字节，已保留最后有效内容`);
  storage.setItem(NOTES_KEY, value);
}
