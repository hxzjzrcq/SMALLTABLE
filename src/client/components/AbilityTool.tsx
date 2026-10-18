import { useEffect, useRef, useState } from 'react';
import type { SmalltableClient } from '../controller';
/** Keep the frame mounted after first open: closing it preserves in-memory batches/history. */
export function AbilityTool({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: SmalltableClient;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    frame = useRef<HTMLIFrameElement>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (open) {
      setStarted(true);
      if (!dialog.current?.open) dialog.current?.showModal();
    } else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.origin === location.origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === 'smalltable.tool-activity'
      )
        actions.activity();
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [actions]);
  return (
    <dialog
      ref={dialog}
      className="ability-tool"
      aria-labelledby="ability-tool-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="ability-tool-heading">
        <div>
          <strong id="ability-tool-title">DNDROLL 属性工具</strong>
          <small>个人本地工具 · 主持人与玩家均可使用 · 不广播到房间</small>
        </div>
        <button onClick={onClose}>返回桌面</button>
      </div>
      {started && <iframe ref={frame} src="/dndroll.html" title="DNDROLL 属性生成器" />}
    </dialog>
  );
}
