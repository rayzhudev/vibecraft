#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const entry = path.join(__dirname, 'vibecraft-mcp.mjs');
const outputDir = path.join(rootDir, 'resources', 'mcp');

const binaryName = process.platform === 'win32' ? 'vibecraft-mcp.exe' : 'vibecraft-mcp';
const outputFile = path.join(outputDir, binaryName);

await fs.mkdir(outputDir, { recursive: true });

const bun = globalThis.Bun;
if (!bun) {
  throw new Error('Bun runtime is required to build the MCP binary.');
}

const subprocess = bun.spawn({
  cmd: ['bun', 'build', '--compile', entry, '--outfile', outputFile],
  cwd: rootDir,
  stdout: 'inherit',
  stderr: 'inherit',
});

const exitCode = await subprocess.exited;
if (exitCode !== 0) {
  process.exit(exitCode);
}

if (process.platform === 'darwin') {
  const codesign = spawnSync('codesign', ['--force', '--sign', '-', outputFile], {
    stdio: 'inherit',
  });

  if (codesign.status !== 0) {
    process.exit(codesign.status ?? 1);
  }
}

process.exit(0);
