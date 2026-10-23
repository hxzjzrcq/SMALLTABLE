import { temporaryId } from '../../shared/session';
import { useRef, useState } from 'react';
import type { Connection } from '../controller';
import { LoginShell } from './LoginShell';
import type { LoginVisualState } from '../login/scene.js';

export function LoginPage({
  maxNotesBytes,
  connection,
  error,
  notice,
  onSubmit,
  onEdit,
  resumable,
  onRetry,
  onLeave,
}: {
  maxNotesBytes?: number;
  connection: Connection;
  error: string;
  notice: string;
  onSubmit: (password: string, name: string) => void;
  resumable?: boolean;
  onRetry?: () => void;
  onLeave?: () => void;
  onEdit: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const idCheck = temporaryId(name);
  const [password, setPassword] = useState(''),
    [validation, setValidation] = useState('');
  // A successful socket handshake still waits for the initial room snapshot.
  const busy = connection !== 'disconnected';
  const state: LoginVisualState = busy ? 'connecting' : error ? 'error' : 'idle';
  const message = busy
    ? notice === '正在同步桌面…' || connection === 'connected'
      ? '正在同步桌面…'
      : connection === 'reconnecting'
        ? '正在重新连接房间…'
        : '正在连接房间…'
    : validation || error || notice;
  return (
    <LoginShell
      state={state}
      passwordError={error.includes('密码错误')}
      maxNotesBytes={maxNotesBytes}
    >
      <form
        className="st-login-form"
        noValidate
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (!idCheck.valid) {
            setValidation('请先输入有效临时 ID：1–16 单位的字母、数字或汉字。');
            return;
          }
          if (!password) {
            setValidation('请先输入房间密码。');
            input.current?.focus();
            return;
          }
          setValidation('');
          onSubmit(password, name);
          setPassword('');
        }}
      >
        <label className="st-login-label" htmlFor="st-login-name">
          临时 ID
        </label>
        <input
          id="st-login-name"
          className="st-login-input"
          autoComplete="off"
          value={name}
          readOnly={busy}
          onChange={(e) => {
            setName(e.target.value);
            setValidation('');
            onEdit();
          }}
        />
        <p className="meta">{idCheck.units} / 16 单位 · 字母、数字占 1，汉字占 2</p>
        <label className="st-login-label" htmlFor="st-login-password">
          房间密码或 DM 密码
        </label>
        <div className="st-login-field">
          <input
            ref={input}
            className="st-login-input"
            id="st-login-password"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="输入密码"
            required
            maxLength={1024}
            value={password}
            readOnly={busy}
            aria-describedby="st-login-message"
            aria-invalid={state === 'error'}
            onChange={(e) => {
              setPassword(e.target.value);
              setValidation('');
              if (error || notice) onEdit();
            }}
          />
        </div>
        <p className="st-login-message" id="st-login-message" role="status" aria-live="polite">
          {message}
        </p>
        <button className="st-login-submit" type="submit" disabled={busy}>
          <span className="st-login-submit-label">{busy ? '连接中' : '进入房间'}</span>
          <span className="st-login-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
      </form>
      {resumable && (
        <div className="button-row">
          <button disabled={busy} onClick={onRetry}>
            重试进入
          </button>
          <button disabled={busy} onClick={onLeave}>
            退出当前会话
          </button>
        </div>
      )}
    </LoginShell>
  );
}
