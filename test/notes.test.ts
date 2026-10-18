import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNotes, writeNotes } from '../src/client/notes-store.js';
test('notes byte limit preserves previous saved content, including multibyte input', () => {
  let stored = '';
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  };
  const max = '中'.repeat(21845);
  writeNotes(storage, max);
  assert.equal(readNotes(storage), max);
  assert.throws(() => writeNotes(storage, max + 'a'));
  assert.equal(stored, max);
});
test('notes storage errors propagate so the interface can report failure', () => {
  assert.throws(
    () =>
      writeNotes(
        {
          getItem: () => '',
          setItem: () => {
            throw Error('quota');
          },
        },
        '笔记',
      ),
    /quota/,
  );
});
