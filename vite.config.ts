import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';
import { execSync } from 'node:child_process';
import pkg from './package.json';

const distRoot = process.env.VIBECRAFT_DIST_DIR ?? 'dist';
const distMain = resolve(distRoot, 'main');
const distPreload = resolve(distRoot, 'preload');
const distRenderer = resolve(distRoot, 'renderer');

export default defineConfig(({ mode }) => {
  const gitBranch = mode === 'production' ? '' : resolveGitBranch();

  return {
    server: {
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      electron([
        {
          entry: 'src/main/index.ts',
          vite: {
            build: {
              outDir: distMain,
              rollupOptions: {
                external: [
                  'electron',
                  'electron-log',
                  'node-pty',
                  'node-pty-prebuilt-multiarch',
                  'node-machine-id',
                  'posthog-node',
                  'ws',
                  'bufferutil',
                  'utf-8-validate',
                ],
              },
            },
          },
        },
        {
          entry: 'src/preload.ts',
          onstart(args) {
            args.reload();
          },
          vite: {
            build: {
              outDir: distPreload,
            },
          },
        },
      ]),
      renderer(),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
      'import.meta.env.VITE_GIT_BRANCH': JSON.stringify(gitBranch),
    },
    build: {
      outDir: distRenderer,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/xterm') || id.includes('node_modules/xterm-addon-fit')) {
              return 'vendor-xterm';
            }
            if (id.includes('node_modules/posthog-js')) {
              return 'vendor-analytics';
            }
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
  };
});

function resolveGitBranch(): string {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    if (!branch) {
      return '';
    }
    if (branch === 'HEAD') {
      const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
      return sha ? `detached@${sha}` : 'detached';
    }
    return branch;
  } catch {
    return '';
  }
}
