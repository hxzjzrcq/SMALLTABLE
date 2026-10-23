import { useSyncExternalStore } from 'react';
import type { SmalltableClient } from '../controller';
export function UploadStatus({ actions, kind }: { actions: SmalltableClient; kind: string }) {
  const state = useSyncExternalStore(actions.subscribe, actions.getSnapshot);
  const status = state.uploads[kind];
  if (!status) return null;
  const text = { uploading: '上传中', processing: '服务器处理中', done: '完成', failed: '失败' }[
    status.phase
  ];
  return (
    <p role="status" className="upload-status">
      {status.name ? `${status.name}：` : ''}
      {text}
      {status.percent !== undefined ? ` ${status.percent}%` : ''}
      {status.message ? `：${status.message}` : ''}
      {status.phase === 'uploading' && <progress max={100} value={status.percent} />}
      {status.phase === 'processing' && <progress />}
    </p>
  );
}
