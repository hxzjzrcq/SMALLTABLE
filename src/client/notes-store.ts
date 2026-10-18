import { bytes } from '../shared/model';
export const NOTES_KEY = 'smalltable.private-notes.v1';
export const NOTES_LIMIT = 65535;
export interface NotesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function readNotes(storage: NotesStorage) {
  const value = storage.getItem(NOTES_KEY) ?? storage.getItem('tabletop.private-notes.v1') ?? '';
  if (bytes(value) > NOTES_LIMIT) throw Error('已存笔记超过当前上限，请先导出浏览器数据');
  return value;
}
export function writeNotes(storage: NotesStorage, value: string) {
  if (bytes(value) > NOTES_LIMIT) throw Error('超过 65535 字节，已保留最后有效内容');
  storage.setItem(NOTES_KEY, value);
}
