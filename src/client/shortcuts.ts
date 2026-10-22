/** Room shortcuts share one guard and one listener; room actions stay in the controller. */
export interface Shortcut {
  key: string;
  enabled: () => boolean;
  run: () => void;
}

export function installShortcuts(target: Window, shortcuts: readonly Shortcut[]) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const document = target.document;
    if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
    // Check the event path as well as focus, including editable descendants and shadow hosts.
    const protectedElement = (node: EventTarget | null) => {
      if (!node || !(node as Element).closest) return false;
      const element = node as HTMLElement;
      return (
        element.isContentEditable ||
        !!element.closest(
          'input, textarea, select, button:not([data-board-selection]), a[href], iframe, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        )
      );
    };
    if (event.composedPath().some(protectedElement) || protectedElement(document.activeElement))
      return;
    const shortcut = shortcuts.find((entry) => entry.key === event.key);
    if (!shortcut?.enabled()) return;
    // Consume even cancellation: it must never fall through to another destructive action.
    event.preventDefault();
    shortcut.run();
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
