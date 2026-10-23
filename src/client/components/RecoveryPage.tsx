import type { ClientState } from '../controller';
import { LoginShell } from './LoginShell';

const labels = {
  checking: '正在检查会话…',
  socket: '正在连接房间…',
  snapshot: '正在同步桌面…',
  retry: '暂时无法恢复桌面',
};
export function RecoveryPage({
  state,
  onRetry,
  onLeave,
}: {
  state: ClientState;
  onRetry: () => void;
  onLeave: () => void;
}) {
  const waiting = state.recovery !== 'retry';
  return (
    <LoginShell
      recovery
      state={waiting ? 'connecting' : 'error'}
      maxNotesBytes={state.caps?.maxNotesBytes}
    >
      <section className="st-recovery" aria-busy={waiting}>
        <h2>恢复共享桌面</h2>
        <p className="st-login-message" role="status" aria-live="polite">
          {labels[state.recovery ?? 'checking']}
        </p>
        <p>{state.error || state.notice || '会话确认后将自动回到桌面。'}</p>
        <div className="button-row">
          {!waiting && (
            <button className="st-login-submit" onClick={onRetry}>
              重试进入
            </button>
          )}
          <button onClick={onLeave}>退出当前会话</button>
        </div>
      </section>
    </LoginShell>
  );
}
