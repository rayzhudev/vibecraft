import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import MaitrixLinkSection from '../../../src/renderer/screens/settings/MaitrixLinkSection';

describe('MaitrixLinkSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test('displays "Not installed" state when memflow is not installed', async () => {
    vi.spyOn(window.electronAPI, 'memflowStatus').mockResolvedValue({
      installed: false,
      daemonRunning: false,
      trackedProjectCount: 0,
      lastSyncedAt: null,
    });

    render(<MaitrixLinkSection />);

    await waitFor(() => {
      expect(screen.getByText('Not installed')).toBeInTheDocument();
    });
    expect(screen.getByText(/Install MemFlow to enable/i)).toBeInTheDocument();
  });

  test('displays "Connected" state with project count when daemon is running', async () => {
    vi.spyOn(window.electronAPI, 'memflowStatus').mockResolvedValue({
      installed: true,
      daemonRunning: true,
      trackedProjectCount: 5,
      lastSyncedAt: '2026-07-16T12:00:00Z',
    });

    render(<MaitrixLinkSection />);

    await waitFor(() => {
      expect(screen.getByText('Connected · 5 projects tracked')).toBeInTheDocument();
    });
  });

  test('displays "Installed · daemon not running" state when daemon is stopped', async () => {
    vi.spyOn(window.electronAPI, 'memflowStatus').mockResolvedValue({
      installed: true,
      daemonRunning: false,
      trackedProjectCount: 2,
      lastSyncedAt: null,
    });

    render(<MaitrixLinkSection />);

    await waitFor(() => {
      expect(screen.getByText('Installed · daemon not running')).toBeInTheDocument();
    });
    expect(screen.getByText(/Start the MemFlow daemon to sync/i)).toBeInTheDocument();
  });

  test('clicking "Open Maitrix Link" calls electronAPI.memflowOpenLink', async () => {
    vi.spyOn(window.electronAPI, 'memflowStatus').mockResolvedValue({
      installed: true,
      daemonRunning: true,
      trackedProjectCount: 1,
      lastSyncedAt: null,
    });
    const openSpy = vi.spyOn(window.electronAPI, 'memflowOpenLink').mockResolvedValue({ success: true });

    render(<MaitrixLinkSection />);

    const openBtn = await screen.findByRole('button', { name: 'Open Maitrix Link' });
    fireEvent.click(openBtn);

    expect(openSpy).toHaveBeenCalled();
  });
});
