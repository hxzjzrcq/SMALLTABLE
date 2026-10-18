import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RuleError,
  isRandomMethod,
  applyAction,
  createSession,
  deserializeSession,
  getSessionView,
  serializeSession,
  type Action,
  type CreateRequest,
  type Locale,
  type Rng,
  type Session,
  type SessionView,
  type Text,
} from '@dndroll/core';

const SESSION_KEY = 'smalltable.dndroll.session.v1';
const PREFS_KEY = 'smalltable.dndroll.prefs.v1';

export interface UiPrefs {
  locale: Locale;
  theme?: 'dark' | 'light';
  /** PF1 购点上次使用的预算（UI 偏好，允许记住 25）。 */
  pf1Budget?: number;
}

export function loadPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { locale: 'zh', theme: 'light' };
    const p = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      locale: p.locale === 'en' ? 'en' : 'zh',
      theme: p.theme === 'dark' ? 'dark' : 'light',
      pf1Budget: typeof p.pf1Budget === 'number' ? p.pf1Budget : undefined,
    };
  } catch {
    return { locale: 'zh', theme: 'light' };
  }
}

export function savePrefs(prefs: UiPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* 离线环境存储不可用时忽略 */
  }
}

export interface RestoreState {
  session: Session | null;
  /** 存档存在但无法恢复时的错误；不静默清除。 */
  corruptError: { code: string; messages: Text } | null;
}

function restoreSaved(): RestoreState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SESSION_KEY);
  } catch {
    return { session: null, corruptError: null };
  }
  if (raw === null) return { session: null, corruptError: null };
  try {
    return { session: deserializeSession(raw), corruptError: null };
  } catch (e) {
    if (e instanceof RuleError)
      return { session: null, corruptError: { code: e.code, messages: e.messages } };
    return {
      session: null,
      corruptError: { code: 'UNKNOWN', messages: { zh: '未知错误。', en: 'Unknown error.' } },
    };
  }
}

export function clearSaved() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export interface RollHistoryEntry {
  id: number;
  session: Session;
}

function isRolledSession(s: Session): boolean {
  const v = getSessionView(s);
  return v.attempt.generated && isRandomMethod(v.method);
}

export interface Controller {
  history: RollHistoryEntry[];
  activeHistoryId: number | null;
  workspaceKey: number;
  nextGroup: () => boolean;
  restoreGroup: (id: number) => void;
  session: Session | null;
  view: SessionView | null;
  resumedFromSave: boolean;
  corruptError: { code: string; messages: Text } | null;
  actionError: { code: string; messages: Text } | null;
  start: (req: CreateRequest) => boolean;
  run: (action: Action) => boolean;
  replaceSession: (s: Session) => void;
  endSession: () => void;
  dismissCorrupt: () => void;
  dismissResumed: () => void;
  clearError: () => void;
}

/**
 * 会话控制器。所有掷骰只发生在事件处理器里（start/run），
 * render 与 effect 中只调用不产生随机数的 getSessionView。
 */
export function useSessionController(rng?: Rng): Controller {
  const [initial] = useState<RestoreState>(() => restoreSaved());
  const [session, setSession] = useState<Session | null>(initial.session);
  const [resumed, setResumed] = useState(initial.session !== null);
  const [corruptError, setCorruptError] = useState(initial.corruptError);
  const [actionError, setActionError] = useState<Controller['actionError']>(null);
  const [history, setHistory] = useState<RollHistoryEntry[]>(() =>
    initial.session && isRolledSession(initial.session)
      ? [{ id: 1, session: initial.session }]
      : [],
  );
  const activeId = useRef<number | null>(history[0]?.id ?? null);
  const nextId = useRef(history.length ? 2 : 1);
  const [activeHistoryId, setActiveHistoryId] = useState(activeId.current);
  const [workspaceKey, setWorkspaceKey] = useState(0);

  // Immutable sessions retain dice, assignments and completion state together.
  // Only this page's memory contains the history; autosave still stores one session.
  const commit = useCallback((s: Session, fresh = false) => {
    if (fresh) {
      activeId.current = null;
      setActiveHistoryId(null);
      setWorkspaceKey((k) => k + 1);
    }
    if (isRolledSession(s)) {
      const id = activeId.current ?? nextId.current++;
      activeId.current = id;
      setActiveHistoryId(id);
      setHistory((previous) => {
        const entry = { id, session: s };
        return previous.some((h) => h.id === id)
          ? previous.map((h) => (h.id === id ? entry : h))
          : [...previous, entry].slice(-10);
      });
    }
    setSession(s);
    setActionError(null);
    setResumed(false);
  }, []);

  useEffect(() => {
    // Preserve unreadable bytes until the user explicitly clears the save.
    if (corruptError) return;
    try {
      if (session) localStorage.setItem(SESSION_KEY, serializeSession(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* 存储不可用时跳过自动保存 */
    }
  }, [session, corruptError]);

  const view = useMemo(() => {
    if (!session) return null;
    try {
      return getSessionView(session);
    } catch {
      return null;
    }
  }, [session]);

  const start = useCallback(
    (req: CreateRequest): boolean => {
      try {
        commit(createSession(req), true);
        return true;
      } catch (e) {
        if (e instanceof RuleError) setActionError({ code: e.code, messages: e.messages });
        return false;
      }
    },
    [commit],
  );

  const run = useCallback(
    (action: Action): boolean => {
      if (!session) return false;
      try {
        // 在事件处理器中一次性计算新 Session，再 setState；不使用函数式更新。
        commit(applyAction(session, action, rng));
        return true;
      } catch (e) {
        if (e instanceof RuleError) {
          setActionError({ code: e.code, messages: e.messages });
          return false;
        }
        throw e;
      }
    },
    [session, rng, commit],
  );

  const nextGroup = useCallback((): boolean => {
    if (!session || !view || !isRolledSession(session)) return false;
    try {
      let next = createSession(session.request);
      if (view.method.mode === 'pool') {
        next = applyAction(next, { type: 'setPool', counts: view.attempt.poolCounts });
      }
      next = applyAction(next, { type: 'roll' }, rng);
      commit(next, true);
      return true;
    } catch (e) {
      if (e instanceof RuleError) {
        setActionError({ code: e.code, messages: e.messages });
        return false;
      }
      throw e;
    }
  }, [session, view, rng, commit]);

  const restoreGroup = useCallback(
    (id: number) => {
      const entry = history.find((h) => h.id === id);
      if (!entry || activeId.current === id) return;
      activeId.current = id;
      setActiveHistoryId(id);
      setWorkspaceKey((k) => k + 1);
      commit(entry.session);
    },
    [history, commit],
  );

  const replaceSession = useCallback((s: Session) => commit(s, true), [commit]);

  const endSession = useCallback(() => {
    activeId.current = null;
    setActiveHistoryId(null);
    setWorkspaceKey((k) => k + 1);
    setSession(null);
    setActionError(null);
    setResumed(false);
  }, []);

  const dismissCorrupt = useCallback(() => {
    clearSaved();
    setCorruptError(null);
  }, []);

  const dismissResumed = useCallback(() => setResumed(false), []);

  const clearError = useCallback(() => setActionError(null), []);

  return {
    history,
    activeHistoryId,
    workspaceKey,
    nextGroup,
    restoreGroup,
    session,
    view,
    resumedFromSave: resumed,
    corruptError,
    actionError,
    start,
    run,
    replaceSession,
    endSession,
    dismissCorrupt,
    dismissResumed,
    clearError,
  };
}
