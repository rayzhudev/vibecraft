import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const builderPath = resolve(rootDir, 'node_modules', '.bin', binName);
const packageJsonPath = resolve(rootDir, 'package.json');
const originalPackageJson = readFileSync(packageJsonPath);
const rootPackageJson = JSON.parse(originalPackageJson.toString('utf8'));

const rawArgs = process.argv.slice(2);

const updateUrl = process.env.VIBECRAFT_UPDATE_URL?.trim();
const updateChannel = process.env.VIBECRAFT_UPDATE_CHANNEL?.trim();

const hasPublishConfig = rawArgs.some((arg) => arg.startsWith('--config.publish'));

const getConfigPath = () => {
  const configIndex = rawArgs.findIndex((arg) => arg === '--config');
  if (configIndex !== -1 && rawArgs[configIndex + 1]) {
    return resolve(rootDir, rawArgs[configIndex + 1]);
  }

  const inlineConfigArg = rawArgs.find((arg) => arg.startsWith('--config='));
  if (inlineConfigArg) {
    return resolve(rootDir, inlineConfigArg.slice('--config='.length));
  }

  return resolve(rootDir, 'electron-builder.json');
};

const loadConfig = (configPath) => {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!config.extends) return config;
  const parentPath = resolve(dirname(configPath), config.extends);
  const parent = loadConfig(parentPath);
  return {
    ...parent,
    ...config,
    directories: { ...(parent.directories ?? {}), ...(config.directories ?? {}) },
    mac: { ...(parent.mac ?? {}), ...(config.mac ?? {}) },
    win: { ...(parent.win ?? {}), ...(config.win ?? {}) },
    linux: { ...(parent.linux ?? {}), ...(config.linux ?? {}) },
    extraMetadata: { ...(parent.extraMetadata ?? {}), ...(config.extraMetadata ?? {}) },
  };
};

const config = loadConfig(getConfigPath());

const args = [...rawArgs];

if (updateUrl && !hasPublishConfig) {
  args.push('--config.publish.provider=generic', `--config.publish.url=${updateUrl}`);
  if (updateChannel) {
    args.push(`--config.publish.channel=${updateChannel}`);
  }
}

let restored = false;
const restorePackageJson = () => {
  if (restored) return;
  restored = true;
  try {
    const current = readFileSync(packageJsonPath);
    if (!current.equals(originalPackageJson)) {
      writeFileSync(packageJsonPath, originalPackageJson);
    }
  } catch {
    writeFileSync(packageJsonPath, originalPackageJson);
  }
};

const runCommand = (command, commandArgs) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit', env: process.env });

    child.on('error', (error) => {
      rejectPromise(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} exited with code ${code ?? 1}`));
      }
    });

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.on(signal, () => {
        if (!child.killed) child.kill(signal);
      });
    }
  });

const resolveMacSigningIdentity = () => {
  if (process.platform !== 'darwin') return null;
  if (process.env.CSC_NAME?.trim()) return process.env.CSC_NAME.trim();

  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return null;
  }

  const lines = result.stdout.split('\n');
  const appleDevelopment = lines.find((line) => line.includes('"Apple Development:'));
  if (!appleDevelopment) {
    return null;
  }

  const match = appleDevelopment.match(/"(.+?)"/);
  return match?.[1] ?? null;
};

const macSigningIdentity = resolveMacSigningIdentity();
if (macSigningIdentity && !process.env.CSC_NAME) {
  process.env.CSC_NAME = macSigningIdentity;
}

const hasExplicitDir = args.includes('--dir');
const isMacArchiveBuild = process.platform === 'darwin' && !hasExplicitDir;
if (isMacArchiveBuild) {
  args.push('--dir');
}

const sanitizeArtifactName = (value) => value.replaceAll('/', '-');

const createDmgStage = (productName, appPath) => {
  const stageDir = mkdtempSync(join(tmpdir(), 'vibecraft-dmg-'));
  const stagedAppPath = join(stageDir, `${productName}.app`);
  const applicationsLinkPath = join(stageDir, 'Applications');
  cpSync(appPath, stagedAppPath, { recursive: true });
  symlinkSync('/Applications', applicationsLinkPath, 'dir');
  return stageDir;
};

const repairMacAppSignature = (appPath) => {
  if (process.platform !== 'darwin') return;
  if (!macSigningIdentity) return;

  const result = spawnSync('codesign', ['--force', '--deep', '--sign', macSigningIdentity, appPath], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`codesign repair failed with code ${result.status ?? 1}`);
  }

  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  });

  if (verify.status !== 0) {
    throw new Error(`codesign verify failed with code ${verify.status ?? 1}`);
  }
};

const createMacArtifacts = async () => {
  const outputDir = resolve(rootDir, config.directories?.output ?? 'dist');
  const productName = config.productName ?? rootPackageJson.productName ?? rootPackageJson.name;
  const version = rootPackageJson.version;
  const arch = process.arch;
  const appDir = join(outputDir, `mac-${arch}`);
  const appPath = join(appDir, `${productName}.app`);
  const zipName = `${sanitizeArtifactName(productName)}-${version}-${arch}-mac.zip`;
  const dmgName = `${sanitizeArtifactName(productName)}-${version}-${arch}.dmg`;
  const zipPath = join(outputDir, zipName);
  const dmgPath = join(outputDir, dmgName);

  repairMacAppSignature(appPath);

  rmSync(zipPath, { force: true });
  rmSync(dmgPath, { force: true });

  await runCommand('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath]);
  const dmgStageDir = createDmgStage(productName, appPath);
  try {
    await runCommand('hdiutil', [
      'create',
      '-volname',
      productName,
      '-srcfolder',
      dmgStageDir,
      '-ov',
      '-format',
      'UDZO',
      dmgPath,
    ]);
  } finally {
    rmSync(dmgStageDir, { recursive: true, force: true });
  }
};

try {
  await runCommand(builderPath, args);
  if (isMacArchiveBuild) {
    await createMacArtifacts();
  }
  restorePackageJson();
} catch (error) {
  restorePackageJson();
  console.error(error);
  process.exit(1);
}

process.on('exit', restorePackageJson);
