// The only outbound message is a content-free activity pulse or a close request.
if (window.parent !== window) {
  let last = 0;
  function activity() {
    if (Date.now() - last <= 10000) return;
    last = Date.now();
    window.parent.postMessage({ type: 'smalltable.tool-activity' }, window.location.origin);
  }
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel'])
    window.addEventListener(type, activity, { passive: true });
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open],.drag-ghost')) {
        event.preventDefault();
        window.parent.postMessage(
          { type: 'smalltable.character-card-close' },
          window.location.origin,
        );
      }
    },
    { capture: true },
  );
}
