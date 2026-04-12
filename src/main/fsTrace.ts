import type { PathLike } from 'fs';
import * as fsModule from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TRACE_FLAG = (process.env.VIBECRAFT_FS_TRACE ?? '').trim() === '1';

const toPathString = (value: PathLike): string | null => {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof URL) return fileURLToPath(value);
  return null;
};

const buildProtectedRoots = (): string[] => {
  const home = os.homedir();
  return ['Desktop', 'Documents', 'Downloads', 'Music', 'Movies', 'Pictures'].map((entry) =>
    path.join(home, entry)
  );
};

const isProtectedPath = (value: string, protectedRoots: string[]): boolean => {
  const resolved = path.resolve(value);
  return protectedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
};

const formatStack = (stack?: string): string => {
  if (!stack) return '';
  return stack.split('\n').slice(2, 8).join('\n');
};

const installFsTrace = (): void => {
  if (!TRACE_FLAG) return;
  const protectedRoots = buildProtectedRoots();
  const wrapSync = (name: keyof typeof fsModule) => {
    const original = fsModule[name];
    if (typeof original !== 'function') return;
    (fsModule as Record<string, unknown>)[name] = (...args: unknown[]) => {
      const target = toPathString(args[0] as PathLike);
      if (target && isProtectedPath(target, protectedRoots)) {
        const stack = formatStack(new Error().stack);
        console.warn('[fs-trace]', name, target, stack ? `\n${stack}` : '');
      }
      return (original as (...inner: unknown[]) => unknown)(...args);
    };
  };

  (
    [
      'accessSync',
      'existsSync',
      'lstatSync',
      'statSync',
      'readdirSync',
      'readFileSync',
      'writeFileSync',
      'openSync',
      'realpathSync',
      'mkdirSync',
      'rmSync',
      'unlinkSync',
    ] as const
  ).forEach(wrapSync);

  console.warn('[fs-trace] enabled', { protectedRoots });
};

installFsTrace();
