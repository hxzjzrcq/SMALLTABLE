import { memo, useEffect, useRef, useState } from 'react';
import type { SmalltableClient } from '../controller';

/** Hiding the dialog keeps this single private card alive; room teardown removes it. */
export const CharacterCardTool = memo(function CharacterCardTool({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: SmalltableClient;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (open) {
      setStarted(true);
      if (!dialog.current?.open) dialog.current?.showModal();
    } else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'smalltable.tool-activity') actions.activity();
      if (event.data?.type === 'smalltable.character-card-close') onClose();
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [actions, onClose]);
  return (
    <dialog
      ref={dialog}
      className="ability-tool character-card-tool"
      aria-labelledby="character-card-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="ability-tool-heading">
        <div>
          <strong id="character-card-title">角色卡管理 · 自由角色卡</strong>
          <small>仅本机编辑 · 返回桌面保留内容 · 离开或刷新前请导出 JSON</small>
        </div>
        <button onClick={onClose}>返回桌面</button>
      </div>
      {started && <iframe ref={frame} src="/character-card.html" title="自由角色卡" />}
    </dialog>
  );
});
