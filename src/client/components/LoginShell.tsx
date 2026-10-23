import { useEffect, useRef, type ReactNode } from 'react';
import { Notes } from './Notes';
import { version } from '../../../package.json';
import { mountLoginScene, type LoginScene, type LoginVisualState } from '../login/scene.js';

/** Shared login/recovery decoration. Owns animation setup and teardown. */
export function LoginShell({
  state,
  passwordError = false,
  maxNotesBytes,
  children,
  recovery = false,
}: {
  state: LoginVisualState;
  passwordError?: boolean;
  maxNotesBytes?: number;
  children: ReactNode;
  recovery?: boolean;
}) {
  const root = useRef<HTMLElement>(null),
    scene = useRef<LoginScene | null>(null);
  useEffect(() => {
    const instance = mountLoginScene(root.current!);
    scene.current = instance;
    return () => {
      instance.destroy();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.setState(state, { passwordError });
  }, [state, passwordError]);
  return (
    <main ref={root} className="st-login" data-state={state} data-recovery={recovery || undefined}>
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
            <p className="st-login-subtitle">
              共享桌面 <small className="st-login-version">v{version}</small>
            </p>
          </div>
          {children}
        </section>
      </div>
      <details className="st-login-notes">
        <summary>查看本机私人笔记</summary>
        <Notes maxBytes={maxNotesBytes} />
      </details>
    </main>
  );
}
