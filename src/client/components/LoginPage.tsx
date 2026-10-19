import { useEffect, useRef, useState } from 'react';
import type { Connection } from '../controller';
import { Notes } from './Notes';
import { mountLoginScene, type LoginScene, type LoginVisualState } from '../login/scene.js';

export function LoginPage({
  maxNotesBytes,
  connection,
  error,
  notice,
  onSubmit,
  onEdit,
}: {
  maxNotesBytes?: number;
  connection: Connection;
  error: string;
  notice: string;
  onSubmit: (password: string) => void;
  onEdit: () => void;
}) {
  const root = useRef<HTMLElement>(null),
    scene = useRef<LoginScene | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState(''),
    [validation, setValidation] = useState('');
  // A successful socket handshake still waits for the initial room snapshot.
  const busy = connection !== 'disconnected';
  const state: LoginVisualState = busy ? 'connecting' : error ? 'error' : 'idle';
  const message = busy
    ? connection === 'connected'
      ? '正在同步桌面…'
      : connection === 'reconnecting'
        ? '正在重新连接房间…'
        : '正在连接房间…'
    : validation || error || notice;
  useEffect(() => {
    const instance = mountLoginScene(root.current!);
    scene.current = instance;
    return () => {
      instance.destroy();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.setState(state, { passwordError: error.includes('密码错误') });
  }, [state, error]);
  return (
    <main ref={root} className="st-login" data-state={state}>
      <div className="st-login-card">
        <section className="st-login-visual" aria-hidden="true">
          <div className="st-login-scene">
            <div className="st-login-status">
              <span>地城 · 第 3 层</span>
              <span className="st-login-status-r" />
            </div>
            <div className="st-login-map" />
            <div className="st-login-log">
              <p className="st-login-log-old" />
              <p className="st-login-log-new" />
            </div>
          </div>
        </section>
        <section className="st-login-panel">
          <div className="st-login-brand">
            <h1 className="st-login-title">
              SMALL<span className="st-login-title-em">TABLE</span>
            </h1>
            <p className="st-login-subtitle">共享桌面</p>
          </div>
          <form
            className="st-login-form"
            noValidate
            aria-busy={busy}
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              if (!password) {
                setValidation('请先输入房间密码。');
                input.current?.focus();
                return;
              }
              setValidation('');
              onSubmit(password);
              setPassword('');
            }}
          >
            <label className="st-login-label" htmlFor="st-login-password">
              房间密码
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
        </section>
      </div>
      <details className="st-login-notes">
        <summary>查看本机私人笔记</summary>
        <Notes maxBytes={maxNotesBytes} />
      </details>
    </main>
  );
}
