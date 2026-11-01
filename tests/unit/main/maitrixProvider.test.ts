import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

let tempUserData = '';

vi.mock('electron', () => ({
  app: {
    getPath: () => tempUserData,
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('maitrixProvider', () => {
  beforeEach(() => {
    tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecraft-maitrix-test-'));
    delete process.env.MAITRIX_API_KEY;
    delete process.env.MEMFLOW_API_KEY;
    delete process.env.MAITRIX_BASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.MAITRIX_API_KEY;
    delete process.env.MEMFLOW_API_KEY;
    delete process.env.MAITRIX_BASE_URL;
    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('lists frontier and local DGX Spark models supported by Maitrix', async () => {
    const { listMaitrixModels } = await import('../../../src/main/services/agentConnect/maitrixProvider');
    const models = listMaitrixModels();

    const ids = models.map((m) => m.id);
    expect(ids).toContain('maitrix-auto');
    expect(ids).toContain('gemini-4-argon-high');
    expect(ids).toContain('claude-opus-5-5-high');
    expect(ids).toContain('gpt-6.1-sol');
    expect(ids).toContain('qwen3.8-agent:latest');
    expect(ids).toContain('qwen3-coder-next');
  });

  test('supports API key login, status reporting, and logout', async () => {
    const { getMaitrixStatus, loginMaitrix, logoutMaitrix } =
      await import('../../../src/main/services/agentConnect/maitrixProvider');

    const loginRes = await loginMaitrix({ method: 'api_key', apiKey: 'mtx-unit-test-123' });
    expect(loginRes.loggedIn).toBe(true);

    const status = getMaitrixStatus();
    expect(status.providerId).toBe('maitrix');
    expect(status.state).toBe('ready');
    expect(status.installed).toBe(true);

    await logoutMaitrix();
    const afterLogout = getMaitrixStatus();
    expect(afterLogout.state).toBe('error');
    expect(afterLogout.message?.toLowerCase()).toContain('login');
  });

  test('streams OpenAI-compatible SSE chat completions and emits delta, usage, summary, and final events', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: 'Hello from ' } }],
          })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: 'Maitrix router!' } }],
            usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      process.env.MAITRIX_API_KEY = 'mtx-stream-key';
      process.env.MAITRIX_BASE_URL = `http://127.0.0.1:${port}/v1`;

      const { runMaitrixPrompt, clearMaitrixSession } =
        await import('../../../src/main/services/agentConnect/maitrixProvider');

      const events: Array<{ type: string; text?: string; summary?: string }> = [];
      const result = await runMaitrixPrompt(
        {
          prompt: 'Write a hello world test',
          system: 'You are Neo.',
          model: 'maitrix-auto',
        },
        (evt) => {
          events.push(evt);
        }
      );

      expect(result.sessionId).toMatch(/^maitrix-/);
      const deltas = events
        .filter((e) => e.type === 'delta')
        .map((e) => e.text)
        .join('');
      expect(deltas).toBe('Hello from Maitrix router!');
      expect(events.some((e) => e.type === 'usage')).toBe(true);
      expect(events.some((e) => e.type === 'summary')).toBe(true);
      expect(events.some((e) => e.type === 'final')).toBe(true);

      if (result.sessionId) {
        clearMaitrixSession(result.sessionId);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
