import { TokenCache } from './types.js';
import os from 'os';
import path from 'path';
import fs from 'fs';

const SERVICE_NAME = 'productboard-mcp';
const ACCOUNT_NAME = 'oauth-tokens';

interface PersistedData {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface PersistedOAuthData {
  cache: TokenCache;
}

function getTokenFilePath(): string {
  const platform = process.platform;

  let configDir: string;
  if (platform === 'win32') {
    configDir = path.join(process.env.APPDATA || os.homedir(), 'productboard-mcp');
  } else if (platform === 'darwin') {
    configDir = path.join(os.homedir(), 'Library', 'Application Support', 'productboard-mcp');
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    configDir = path.join(xdgConfig, 'productboard-mcp');
  }

  return path.join(configDir, 'tokens.json');
}

function serialise(data: PersistedData): string {
  return JSON.stringify(data);
}

function deserialise(raw: string): PersistedOAuthData {
  const data: PersistedData = JSON.parse(raw);
  return {
    cache: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    },
  };
}

function toPersistedData(cache: TokenCache): PersistedData {
  return {
    accessToken: cache.accessToken,
    refreshToken: cache.refreshToken,
    expiresAt: cache.expiresAt?.toISOString(),
  };
}

async function tryKeychainSave(data: PersistedData): Promise<void> {
  const { setPassword } = await import('keytar');
  await setPassword(SERVICE_NAME, ACCOUNT_NAME, serialise(data));
}

async function tryKeychainLoad(): Promise<PersistedOAuthData | null> {
  const { getPassword } = await import('keytar');
  const value = await getPassword(SERVICE_NAME, ACCOUNT_NAME);
  return value ? deserialise(value) : null;
}

async function tryKeychainClear(): Promise<void> {
  const { deletePassword } = await import('keytar');
  await deletePassword(SERVICE_NAME, ACCOUNT_NAME);
}

function saveToFile(data: PersistedData, filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, serialise(data), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o600);
  }
}

function loadFromFile(filePath: string): PersistedOAuthData | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return deserialise(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export class TokenPersistence {
  private filePath: string;

  constructor() {
    this.filePath = getTokenFilePath();
  }

  async save(cache: TokenCache): Promise<void> {
    const data = toPersistedData(cache);
    try {
      await tryKeychainSave(data);
      return;
    } catch {
      // keytar not available or keychain locked — fall through to file
    }
    saveToFile(data, this.filePath);
  }

  async load(): Promise<PersistedOAuthData | null> {
    try {
      const cached = await tryKeychainLoad();
      if (cached) return cached;
    } catch {
      // fall through to file
    }
    return loadFromFile(this.filePath);
  }

  async clear(): Promise<void> {
    try {
      await tryKeychainClear();
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {
      // ignore
    }
  }
}
