import { JSDOM } from 'jsdom';

process.env.VIBECRAFT_TEST_MODE = '1';
process.env.VIBECRAFT_TEST_DISABLE_GIT = '0';
process.env.GIT_CONFIG_COUNT = '1';
process.env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
process.env.GIT_CONFIG_VALUE_0 = '/dev/null';

// Node 22+ defines some globals (e.g. navigator) as getter-only; use defineProperty as fallback.
function setGlobal(key: string, value: unknown): void {
  try {
    (globalThis as any)[key] = value;
  } catch {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
}

// Provide a minimal DOM/window for tests that may pull renderer modules under the main config.
if (typeof (globalThis as any).window === 'undefined') {
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
  setGlobal(
    'electronAPI',
    (window as any).electronAPI ??
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
