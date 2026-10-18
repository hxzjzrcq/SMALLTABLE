import { useEffect, useSyncExternalStore } from 'react';
import { smalltable } from './controller';
export function useSmalltable() {
  const state = useSyncExternalStore(smalltable.subscribe, smalltable.getSnapshot);
  useEffect(() => {
    void smalltable.loadConfig();
    const activity = () => smalltable.activity();
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'input'])
      window.addEventListener(type, activity, { passive: true });
    return () => {
      for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'input'])
        window.removeEventListener(type, activity);
    };
  }, []);
  return { ...state, actions: smalltable };
}
