import { getSessionView, type Session, type SessionView } from '@dndroll/core';

// Sessions are immutable snapshots. New actions produce a new key; removed groups
// can be collected. Views contain bilingual data, never locale-specific UI text.
const views = new WeakMap<Session, SessionView>();
export function getHistoryView(session: Session): SessionView {
  let view = views.get(session);
  if (!view) {
    view = getSessionView(session);
    views.set(session, view);
  }
  return view;
}
