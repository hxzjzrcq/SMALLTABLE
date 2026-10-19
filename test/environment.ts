import { JSDOM, type ConstructorOptions } from 'jsdom';

export function createDom(html = '<div id="root"></div>', options: ConstructorOptions = {}) {
  return new JSDOM(html, { url: 'http://localhost', ...options });
}

/** Restore property descriptors as well as values, including absent globals. */
export function installGlobals(values: Record<string, unknown>) {
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}

export function installDomGlobals(dom: JSDOM, extra: Record<string, unknown> = {}) {
  return installGlobals({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    ...extra,
  });
}
