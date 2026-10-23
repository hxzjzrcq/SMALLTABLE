import { useState } from 'react';
import type { SmalltableClient } from '../controller';
export function Diagnostics({ actions, code }: { actions: SmalltableClient; code?: string }) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  return (
    <details
      className="diagnostics"
      onToggle={(e) => {
        if (e.currentTarget.open) setText(actions.diagnostic());
      }}
    >
      <summary>诊断信息{code ? ` · ${code}` : ''}</summary>
      <textarea
        aria-label="脱敏诊断信息"
        readOnly
        value={text}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setMessage('已复制');
          } catch {
            setMessage('复制不可用，请选中上方文字复制');
          }
        }}
      >
        复制诊断
      </button>
      <span role="status">{message}</span>
    </details>
  );
}
