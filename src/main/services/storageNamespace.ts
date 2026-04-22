import pkg from '../../../package.json';

export type StorageNamespace = 'dev' | 'prod';

const PROD_WORKSPACE_DIR = '.vibecraft';
const DEV_WORKSPACE_DIR = '.vibecraft-dev';

export const resolveStorageNamespace = (): StorageNamespace => {
  const fromEnv = process.env.VIBECRAFT_STORAGE_NAMESPACE;
  if (fromEnv === 'dev' || fromEnv === 'prod') {
    return fromEnv;
  }

  const fromPackage = (pkg as { vibecraftStorageNamespace?: unknown }).vibecraftStorageNamespace;
  if (fromPackage === 'dev' || fromPackage === 'prod') return fromPackage;

  return 'prod';
};

export const getStorageNamespace = (): StorageNamespace => resolveStorageNamespace();

export const getWorkspaceStorageDirName = (): string => {
  return resolveStorageNamespace() === 'dev' ? DEV_WORKSPACE_DIR : PROD_WORKSPACE_DIR;
};

export const getWorkspaceStorageDirCandidates = (): string[] => {
  return resolveStorageNamespace() === 'dev' ? [DEV_WORKSPACE_DIR] : [PROD_WORKSPACE_DIR];
};

export const getWorkspaceStorageDirNames = (): { prod: string; dev: string } => ({
  prod: PROD_WORKSPACE_DIR,
  dev: DEV_WORKSPACE_DIR,
});
