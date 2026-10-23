import { useEffect, useRef, useState } from 'react';
import { PUBLIC_LETTERS, tokenLabel, type PublicToken } from '../../shared/model';
import type { SmalltableClient } from '../controller';
export function LabelEditor({
  token,
  actions,
  connected,
}: {
  token: PublicToken;
  actions: SmalltableClient;
  connected: boolean;
}) {
  const [label, setLabel] = useState(token.label);
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const composing = useRef(false);
  useEffect(() => {
    if (composing.current) return;
    if (!dirty || token.label === label) {
      setLabel(token.label);
      setDirty(false);
    }
  }, [token.label, label, dirty]);
  return (
    <form
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (composing.current) return;
        const parsed = tokenLabel.safeParse(label);
        if (parsed.success && actions.setLabel(token.id, parsed.data)) {
          setLabel(parsed.data);
          setMessage('已提交');
        }
      }}
    >
      <label>
        棋面文字（1–4 字符）
        <input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      <button disabled={!connected || !tokenLabel.safeParse(label).success}>保存棋面文字</button>
      <span role="status">{message}</span>
    </form>
  );
}
export function PublicBox({
  tokens,
  connected,
  onTake,
  onLocate,
  onSelect,
}: {
  tokens: PublicToken[];
  connected: boolean;
  onTake: (letter: string) => void;
  onLocate: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="panel public-box">
      <h2>
        公共棋子盒 <span className="meta">桌上 {tokens.length} / 26</span>
      </h2>
      <div className="public-letters">
        {PUBLIC_LETTERS.map((letter) => {
          const token = tokens.find((t) => t.publicId === letter);
          return (
            <button
              key={letter}
              disabled={!connected && !token}
              className={token ? 'active' : ''}
              title={token ? `${letter} · ${token.label}（桌上）` : `${letter}（可取用）`}
              onDoubleClick={() => token && onLocate(token.id)}
              onClick={() => (token ? onSelect(token.id) : onTake(letter))}
            >
              {letter}
              {token ? ' · 桌上' : ''}
            </button>
          );
        })}
      </div>
    </section>
  );
}
