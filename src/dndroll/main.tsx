import { createRoot } from 'react-dom/client';
import App from './App';
import './upstream.css';
import './embedded.css';
// Only a content-free activity pulse crosses the tool boundary. No sessions or notes.
let last = 0;
function activity() {
  if (window.parent !== window && Date.now() - last > 10000) {
    last = Date.now();
    window.parent.postMessage({ type: 'smalltable.tool-activity' }, window.location.origin);
  }
}
for (const type of ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel'])
  window.addEventListener(type, activity, { passive: true });
createRoot(document.getElementById('root')!).render(<App />);
