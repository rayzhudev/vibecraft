import { JSDOM } from 'jsdom';

// Node 22+ defines some globals (e.g. navigator) as getter-only; use defineProperty as fallback.
function setGlobal(key: string, value: unknown): void {
  try {
    (globalThis as any)[key] = value;
  } catch {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
}

// Ensure a DOM is available (covers accidental node env runs on renderer tests)
if (
  typeof (globalThis as any).window === 'undefined' ||
  typeof (globalThis as any).document === 'undefined'
) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  const { window } = dom;
  setGlobal('window', window);
  setGlobal('document', window.document);
  setGlobal('navigator', window.navigator);
  setGlobal('HTMLElement', window.HTMLElement);
  setGlobal('localStorage', window.localStorage);
  setGlobal('getComputedStyle', window.getComputedStyle);
  setGlobal(
    'matchMedia',
    window.matchMedia ?? (() => ({ matches: false, addListener() {}, removeListener() {} }))
  );
  setGlobal(
    'requestAnimationFrame',
    window.requestAnimationFrame ?? ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16))
  );
  setGlobal('cancelAnimationFrame', window.cancelAnimationFrame ?? clearTimeout);
}

// Ensure a stub electronAPI exists
if (!(globalThis as any).electronAPI) {
  setGlobal(
    'electronAPI',
    new Proxy(
      {},
      {
        get:
          () =>
          (..._args: unknown[]) =>
            Promise.resolve(undefined),
      }
    )
  );
}
