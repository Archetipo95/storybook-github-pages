import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  version: 1,
  mode: 'artifact',
  path: 'storybook-static',
  pages_branch: 'gh-pages',
  target_directory: '',
  environment: '',
  site_url: '',
  base_path: '',
  artifact_name: 'github-pages',
  managed_directories: [],
  package_manager: 'npm',
  preview_root: 'pr-preview',
  preview_retention_days: 30,
  build: {
    install_command: null,
    build_command: null
  }
};

export const ALLOWED_PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun']);
export const COMPOSITE_PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm']);
export const ALLOWED_MODES = new Set(['artifact', 'directory']);

const PROTECTED_DIRECTORIES = new Set(['.git', '.github']);
const BUN_DEFAULT_BUILD = {
  install_command: 'bun install --frozen-lockfile',
  build_command: 'bun run build-storybook'
};

export function validateRelativeDirectory(value, field = 'target_directory', { allowEmpty = false } = {}) {
  if (allowEmpty && (value === undefined || value === '' || value === '.' || value === './')) return true;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty relative directory`);
  }
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.startsWith('/') ||
    normalized.includes(':') ||
    PROTECTED_DIRECTORIES.has(normalized.split('/')[0])
  ) {
    throw new Error(`${field} "${value}" is unsafe. It must remain within the Pages branch.`);
  }
  return true;
}

export function validateConfig(config, { allowedPackageManagers = ALLOWED_PACKAGE_MANAGERS } = {}) {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Configuration must be a non-null object');
  }

  if (config.version !== undefined) {
    if (typeof config.version !== 'number' || config.version !== 1) {
      throw new Error(`Unsupported configuration version: ${config.version}. Only version 1 is supported.`);
    }
  }

  if (config.mode !== undefined) {
    if (!ALLOWED_MODES.has(config.mode)) {
      throw new Error(`Unsupported mode: "${config.mode}". Supported modes: artifact, directory.`);
    }
  }

  if (config.package_manager !== undefined) {
    if (!allowedPackageManagers.has(config.package_manager)) {
      throw new Error(
        `Unsupported package_manager: "${config.package_manager}". Allowed options: ${[...allowedPackageManagers].join(', ')}.`
      );
    }
  }

  if (config.path !== undefined) {
    if (typeof config.path !== 'string' || config.path.trim() === '') {
      throw new Error('Config path must be a non-empty string');
    }

    const normalized = path.normalize(config.path);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(
        `Config path "${config.path}" is unsafe. Path must be relative and contained within the repository root.`
      );
    }
  }

  if (config.pages_branch !== undefined) {
    if (
      typeof config.pages_branch !== 'string' ||
      !/^[A-Za-z0-9._/-]+$/.test(config.pages_branch) ||
      config.pages_branch.startsWith('/') ||
      config.pages_branch.includes('..')
    ) {
      throw new Error(`Invalid pages_branch: "${config.pages_branch}"`);
    }
  }
  if (config.target_directory !== undefined)
    validateRelativeDirectory(config.target_directory, 'target_directory', { allowEmpty: true });
  if (config.environment !== undefined)
    validateRelativeDirectory(config.environment, 'environment', { allowEmpty: true });
  for (const field of ['site_url', 'base_path']) {
    if (config[field] !== undefined && typeof config[field] !== 'string') {
      throw new Error(`Config ${field} must be a string`);
    }
  }
  if (config.managed_directories !== undefined) {
    const values = Array.isArray(config.managed_directories)
      ? config.managed_directories
      : String(config.managed_directories)
          .split(',')
          .map(value => value.trim())
          .filter(Boolean);
    values.forEach(value => validateRelativeDirectory(value, 'managed_directories'));
  }

  if (config.preview_root !== undefined) {
    validateRelativeDirectory(config.preview_root, 'preview_root', { allowEmpty: true });
  }

  if (config.preview_retention_days !== undefined) {
    const days = Number(config.preview_retention_days);
    if (!Number.isInteger(days) || days < 0) {
      throw new Error(
        `Config preview_retention_days must be a non-negative integer, got "${config.preview_retention_days}"`
      );
    }
  }

  if (config.build !== undefined && config.build !== null) {
    if (typeof config.build !== 'object') {
      throw new Error('Config "build" must be an object');
    }
    if (config.build.install_command !== undefined && config.build.install_command !== null) {
      if (typeof config.build.install_command !== 'string') {
        throw new Error('Config build.install_command must be a string');
      }
    }
    if (config.build.build_command !== undefined && config.build.build_command !== null) {
      if (typeof config.build.build_command !== 'string') {
        throw new Error('Config build.build_command must be a string');
      }
    }
  }

  return true;
}

export function parseSimpleYaml(content) {
  const result = {};
  let currentSection = null;

  const lines = content.split('\n');
  for (let line of lines) {
    const commentIdx = line.indexOf('#');
    if (commentIdx !== -1) {
      line = line.slice(0, commentIdx);
    }
    if (!line.trim()) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    if (indent === 0) {
      currentSection = null;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        if (val) {
          result[key] = parseValue(val);
        } else {
          result[key] = {};
          currentSection = key;
        }
      }
    } else if (indent > 0 && currentSection) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        result[currentSection][key] = parseValue(val);
      }
    }
  }

  return result;
}

function parseValue(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  if (val !== '' && !isNaN(Number(val))) return Number(val);
  return val;
}

export function loadConfigFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = parseSimpleYaml(content);
  validateConfig(parsed);
  return parsed;
}

export function resolveConfiguration({
  inputs = {},
  configFilePath = '.storybook-pages.yml',
  allowedPackageManagers = ALLOWED_PACKAGE_MANAGERS
} = {}) {
  let fileConfig = null;
  if (fs.existsSync(configFilePath)) {
    fileConfig = loadConfigFile(configFilePath);
  }

  const packageManager = inputs.package_manager || fileConfig?.package_manager || DEFAULT_CONFIG.package_manager;
  const defaultBuild = packageManager === 'bun' ? BUN_DEFAULT_BUILD : DEFAULT_CONFIG.build;
  const merged = {
    version: fileConfig?.version ?? DEFAULT_CONFIG.version,
    mode: inputs.mode || fileConfig?.mode || DEFAULT_CONFIG.mode,
    path: inputs.path || fileConfig?.path || DEFAULT_CONFIG.path,
    pages_branch: inputs.pages_branch || fileConfig?.pages_branch || DEFAULT_CONFIG.pages_branch,
    target_directory: inputs.target_directory || fileConfig?.target_directory || DEFAULT_CONFIG.target_directory,
    environment: inputs.environment || fileConfig?.environment || DEFAULT_CONFIG.environment,
    site_url: inputs.site_url || fileConfig?.site_url || DEFAULT_CONFIG.site_url,
    base_path: inputs.base_path || fileConfig?.base_path || DEFAULT_CONFIG.base_path,
    artifact_name: inputs.artifact_name || fileConfig?.artifact_name || DEFAULT_CONFIG.artifact_name,
    managed_directories:
      inputs.managed_directories || fileConfig?.managed_directories || DEFAULT_CONFIG.managed_directories,
    package_manager: packageManager,
    preview_root:
      inputs.preview_root !== undefined && inputs.preview_root !== ''
        ? inputs.preview_root === '.' || inputs.preview_root === './'
          ? ''
          : inputs.preview_root
        : fileConfig?.preview_root !== undefined
          ? fileConfig.preview_root === '.' || fileConfig.preview_root === './'
            ? ''
            : fileConfig.preview_root
          : DEFAULT_CONFIG.preview_root,
    preview_retention_days: Number(
      inputs.preview_retention_days !== undefined && inputs.preview_retention_days !== ''
        ? inputs.preview_retention_days
        : fileConfig?.preview_retention_days !== undefined && fileConfig?.preview_retention_days !== ''
          ? fileConfig.preview_retention_days
          : DEFAULT_CONFIG.preview_retention_days
    ),
    build: {
      install_command:
        inputs.install_command ||
        inputs.custom_install_command ||
        fileConfig?.build?.install_command ||
        defaultBuild.install_command,
      build_command:
        inputs.build_command ||
        inputs.custom_build_command ||
        fileConfig?.build?.build_command ||
        defaultBuild.build_command
    }
  };

  validateConfig(merged, { allowedPackageManagers });
  return merged;
}

export function resolveDeploymentTarget(config) {
  validateConfig(config);
  if (config.mode !== 'directory')
    return { directory: null, basePath: config.base_path || '/', url: config.site_url || '' };
  const directory = config.target_directory || config.environment || '';
  validateRelativeDirectory(directory, 'deployment target directory', { allowEmpty: true });
  const basePath = config.base_path || (directory ? `/${directory}` : '/');
  return {
    directory,
    basePath: basePath.startsWith('/') ? basePath : `/${basePath}`,
    url: config.site_url ? `${config.site_url.replace(/\/$/, '')}${basePath === '/' ? '' : basePath}` : ''
  };
}

if (process.argv[1] && process.argv[1].endsWith('config.js')) {
  try {
    const config = resolveConfiguration();
    console.log(JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Config resolution error:', err.message);
    process.exit(1);
  }
}
