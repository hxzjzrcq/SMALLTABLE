import { useEffect, useSyncExternalStore } from 'react';
import { smalltable } from './controller';

export function useSmalltable() {
  const state = useSyncExternalStore(smalltable.subscribe, smalltable.getSnapshot);
  useEffect(() => {
    void smalltable.loadConfig();
    void smalltable.initialize();
    window.addEventListener('online', smalltable.online);
    return () => {
      window.removeEventListener('online', smalltable.online);
    };
  }, []);
  return { ...state, actions: smalltable };
}
