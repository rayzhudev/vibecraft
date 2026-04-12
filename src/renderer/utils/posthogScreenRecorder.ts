import posthog from 'posthog-js';

const TELEMETRY_FETCH_ATTEMPTS = 6;
const TELEMETRY_FETCH_BASE_DELAY_MS = 250;
const DEV_DISTINCT_ID_KEY = 'vibecraftPosthogDistinctId';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getOrCreateDistinctId = (): string => {
  if (typeof window === 'undefined') return `vibecraft-${Date.now()}-${Math.random()}`;
  try {
    const existing = window.localStorage.getItem(DEV_DISTINCT_ID_KEY);
    if (existing) return existing;
    const created = window.crypto?.randomUUID?.() ?? `vibecraft-${Date.now()}-${Math.random()}`;
    window.localStorage.setItem(DEV_DISTINCT_ID_KEY, created);
    return created;
  } catch {
    return window.crypto?.randomUUID?.() ?? `vibecraft-${Date.now()}-${Math.random()}`;
  }
};

const fetchPosthogConfig = async (): Promise<{ apiKey: string; host: string } | null> => {
  if (typeof window === 'undefined') return null;
  if (window.electronAPI?.isTestMode) return null;
  if (import.meta.env.DEV && import.meta.env.VITE_POSTHOG_RECORDING_DEV !== '1') return null;

  try {
    const runtimeConfig = await window.electronAPI?.getPosthogConfig?.();
    if (runtimeConfig?.apiKey) {
      return runtimeConfig;
    }
  } catch {
    /* fall through */
  }

  const apiKey = import.meta.env.VITE_POSTHOG_API_KEY?.trim();
  if (!apiKey) return null;
  const host = (import.meta.env.VITE_POSTHOG_HOST ?? 'https://app.posthog.com').trim();
  return { apiKey, host };
};

const fetchTelemetryContext = async (): Promise<{
  distinctId: string;
  version: string;
  platform: string;
} | null> => {
  const api = window?.electronAPI;
  if (!api?.getTelemetryContext) return null;

  for (let attempt = 0; attempt < TELEMETRY_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const ctx = await api.getTelemetryContext();
      if (ctx?.distinctId) {
        return ctx;
      }
    } catch {
      /* retry */
    }
    await sleep(TELEMETRY_FETCH_BASE_DELAY_MS * (attempt + 1));
  }

  if (!import.meta.env.DEV) {
    return null;
  }

  // In dev we don't initialize posthog-node telemetry, so the preload bridge won't have a distinctId.
  // Fall back to a renderer-persisted id so session recording still works.
  return {
    distinctId: getOrCreateDistinctId(),
    version: import.meta.env.VITE_APP_VERSION ?? 'unknown',
    platform: 'desktop',
  };
};

const getRecorder = () =>
  posthog as unknown as {
    startSessionRecording?: () => void;
    stopSessionRecording?: () => void;
  };

type ReplaySource = 'tutorial' | 'paywall';

let initPromise: Promise<boolean> | null = null;
let recorderReady = false;
let recordingActive = false;
let stopRequested = false;
const activeSources = new Set<ReplaySource>();

const initPosthogRecorder = async (): Promise<boolean> => {
  if (recorderReady) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const config = await fetchPosthogConfig();
      if (!config) return false;

      const telemetry = await fetchTelemetryContext();
      if (!telemetry) return false;

      posthog.init(config.apiKey, {
        api_host: config.host,
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
        disable_scroll_properties: true,
        disable_surveys: true,
        session_recording: {
          maskAllInputs: true,
        },
      });

      posthog.identify(telemetry.distinctId, {
        app_name: 'vibecraft',
        app_surface: 'desktop',
        app_version: telemetry.version,
        platform: telemetry.platform,
      });

      const recorder = getRecorder();
      return (
        typeof recorder.startSessionRecording === 'function' ||
        typeof recorder.stopSessionRecording === 'function'
      );
    } catch {
      return false;
    }
  })();

  const ready = await initPromise;
  recorderReady = ready;
  if (!ready) {
    initPromise = null;
  }
  return ready;
};

const ensureRecording = async (): Promise<void> => {
  if (recordingActive) return;
  const ready = await initPosthogRecorder();
  if (!ready) return;
  if (stopRequested || activeSources.size === 0) return;

  recordingActive = true;
  getRecorder().startSessionRecording?.();
};

const startSessionReplay = (source: ReplaySource): void => {
  if (activeSources.has(source)) return;
  activeSources.add(source);
  stopRequested = false;
  void ensureRecording();
};

const stopSessionReplay = (source: ReplaySource): void => {
  if (!activeSources.delete(source)) return;
  if (activeSources.size > 0) return;
  stopRequested = true;
  if (!recordingActive) return;

  recordingActive = false;
  getRecorder().stopSessionRecording?.();
};

export const startTutorialSessionReplay = (): void => startSessionReplay('tutorial');
export const stopTutorialSessionReplay = (): void => stopSessionReplay('tutorial');
export const startPaywallSessionReplay = (): void => startSessionReplay('paywall');
export const stopPaywallSessionReplay = (): void => stopSessionReplay('paywall');
