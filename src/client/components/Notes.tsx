import { useState } from 'react';
import { bytes } from '../../shared/model';
import { download } from '../controller';
import { readNotes, writeNotes, NOTES_LIMIT as MAX } from '../notes-store';
export function Notes() {
  const [initial] = useState(() => {
    try {
      return { text: readNotes(localStorage), error: '' };
    } catch {
      return { text: '', error: '无法读取浏览器笔记存储，请检查浏览器设置' };
    }
  });
  const [error, setError] = useState(initial.error);
  const [text, setText] = useState(initial.text);
  const [composing, setComposing] = useState(false);
  function commit(value: string) {
    if (bytes(value) > MAX) {
      setError('超过 65535 字节，已保留最后有效内容');
      return;
    }
    setText(value);
    try {
      writeNotes(localStorage, value);
      setError('');
    } catch {
      setError('浏览器保存失败，请复制或导出备份');
    }
  }
  const [draft, setDraft] = useState(text);
  function accept(value: string) {
    if (bytes(value) > MAX) {
      setDraft(text);
      setError('超过 65535 字节，已保留最后有效内容');
    } else {
      commit(value);
      setDraft(value);
    }
  }
  async function importText(file?: File) {
    if (!file) return;
    if (file.size > MAX) {
      setError('文件超过字节上限');
      return;
    }
    try {
      const value = await file.text();
      if (bytes(value) > MAX) throw Error('文件超过字节上限');
      if (confirm('用导入的 TXT 覆盖当前笔记？')) accept(value);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="panel notes">
      <h2>
        私人笔记 <span className="badge">仅本机</span>
      </h2>
      <p className="hint">换设备前请自行导出。房间备份不包含笔记。</p>
      <textarea
        aria-label="私人笔记"
        value={draft}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(e) => {
          setComposing(false);
          accept(e.currentTarget.value);
        }}
        onChange={(e) => {
          if (composing) setDraft(e.target.value);
          else accept(e.target.value);
        }}
      />
      <div className="meta">
        {bytes(draft)} / {MAX} 字节
      </div>
      <div className="button-row">
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(text)
              .then(() => setError('已复制'))
              .catch(() => setError('复制失败，请手动选择文字复制'))
          }
        >
          复制
        </button>
        <button
          onClick={() =>
            download(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'SMALLTABLE-notes.txt')
          }
        >
          导出 TXT
        </button>
        <label className="button">
          导入 TXT
          <input
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={(e) => {
              void importText(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {error && (
        <p role="status" className="hint">
          {error}
        </p>
      )}
    </section>
  );
}
