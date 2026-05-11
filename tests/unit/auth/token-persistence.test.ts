/**
 * Unit tests for TokenPersistence.
 *
 * Covers the keychain-first / file-fallback storage strategy and, critically,
 * the `scope` field that was added in v0.4.6 to support startup scope-mismatch
 * detection when PRODUCTBOARD_FULL_ACCESS is toggled between launches.
 */

// Mock keytar as a virtual module — it is a native add-on that may not be
// present in the CI environment. The factory runs at hoist time so we use
// jest.fn() directly; individual tests configure the behaviour via
// jest.requireMock().
jest.mock('keytar', () => ({
  setPassword: jest.fn(),
  getPassword: jest.fn(),
  deletePassword: jest.fn(),
}), { virtual: true });

// Partially mock `fs` — only the functions used by TokenPersistence.
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    renameSync: jest.fn(),
    chmodSync: jest.fn(),
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    unlinkSync: jest.fn(),
  };
});

import { TokenPersistence } from '../../../src/auth/token-persistence.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMockKeytar() {
  return jest.requireMock('keytar') as {
    setPassword: jest.Mock;
    getPassword: jest.Mock;
    deletePassword: jest.Mock;
  };
}

function getMockFs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('fs') as {
    mkdirSync: jest.Mock;
    writeFileSync: jest.Mock;
    renameSync: jest.Mock;
    chmodSync: jest.Mock;
    existsSync: jest.Mock;
    readFileSync: jest.Mock;
    unlinkSync: jest.Mock;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TokenPersistence', () => {
  let persistence: TokenPersistence;
  let mockKeytar: ReturnType<typeof getMockKeytar>;
  let mockFs: ReturnType<typeof getMockFs>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKeytar = getMockKeytar();
    mockFs = getMockFs();
    persistence = new TokenPersistence();
  });

  // -------------------------------------------------------------------------
  // save() — keychain path
  // -------------------------------------------------------------------------

  describe('save() via keychain', () => {
    beforeEach(() => {
      mockKeytar.setPassword.mockResolvedValue(undefined);
    });

    it('stores accessToken, refreshToken and expiresAt in the keychain', async () => {
      const expiresAt = new Date('2030-06-01T00:00:00.000Z');
      await persistence.save({ accessToken: 'at', refreshToken: 'rt', expiresAt });

      expect(mockKeytar.setPassword).toHaveBeenCalledTimes(1);
      const stored = JSON.parse(mockKeytar.setPassword.mock.calls[0][2]);
      expect(stored.accessToken).toBe('at');
      expect(stored.refreshToken).toBe('rt');
      expect(stored.expiresAt).toBe('2030-06-01T00:00:00.000Z');
    });

    it('persists scope alongside the token cache when scope is provided', async () => {
      await persistence.save(
        { accessToken: 'at', refreshToken: 'rt' },
        'entities:read notes:read notes:write',
      );

      const stored = JSON.parse(mockKeytar.setPassword.mock.calls[0][2]);
      expect(stored.scope).toBe('entities:read notes:read notes:write');
    });

    it('persists full scope when fullAccess scope is provided', async () => {
      await persistence.save(
        { accessToken: 'at' },
        'entities:read entities:write entities:delete notes:read notes:write notes:delete',
      );

      const stored = JSON.parse(mockKeytar.setPassword.mock.calls[0][2]);
      expect(stored.scope).toBe(
        'entities:read entities:write entities:delete notes:read notes:write notes:delete',
      );
    });

    it('does not set a scope field when none is provided', async () => {
      await persistence.save({ accessToken: 'at' });

      const stored = JSON.parse(mockKeytar.setPassword.mock.calls[0][2]);
      expect(stored.scope).toBeUndefined();
    });

    it('does not write to the file when keychain succeeds', async () => {
      await persistence.save({ accessToken: 'at' }, 'entities:read notes:read notes:write');

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // save() — file fallback
  // -------------------------------------------------------------------------

  describe('save() via file fallback (keychain unavailable)', () => {
    beforeEach(() => {
      mockKeytar.setPassword.mockRejectedValue(new Error('keychain locked'));
    });

    it('falls back to writing a file when keychain throws', async () => {
      await persistence.save({ accessToken: 'at' });

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('writes scope to the fallback file', async () => {
      await persistence.save(
        { accessToken: 'at' },
        'entities:read notes:read notes:write',
      );

      // writeFileSync is called with the tmp path; first arg is path, second is content
      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
      expect(written.scope).toBe('entities:read notes:read notes:write');
    });

    it('does not include a scope field in the file when none is provided', async () => {
      await persistence.save({ accessToken: 'at' });

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
      expect(written.scope).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // load() — keychain path
  // -------------------------------------------------------------------------

  describe('load() via keychain', () => {
    it('returns cache and scope when both are stored', async () => {
      const raw = JSON.stringify({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: '2030-06-01T00:00:00.000Z',
        scope: 'entities:read notes:read notes:write',
      });
      mockKeytar.getPassword.mockResolvedValue(raw);

      const result = await persistence.load();

      expect(result).not.toBeNull();
      expect(result!.cache.accessToken).toBe('at');
      expect(result!.cache.refreshToken).toBe('rt');
      expect(result!.cache.expiresAt).toEqual(new Date('2030-06-01T00:00:00.000Z'));
      expect(result!.scope).toBe('entities:read notes:read notes:write');
    });

    it('returns undefined scope for old tokens that predate the scope field (backward compatibility)', async () => {
      // Tokens written by v0.4.5 and earlier do not have a scope field.
      const raw = JSON.stringify({
        accessToken: 'at',
        refreshToken: 'rt',
      });
      mockKeytar.getPassword.mockResolvedValue(raw);

      const result = await persistence.load();

      expect(result).not.toBeNull();
      expect(result!.cache.accessToken).toBe('at');
      expect(result!.scope).toBeUndefined();
    });

    it('returns null when the keychain has no entry', async () => {
      mockKeytar.getPassword.mockResolvedValue(null);

      const result = await persistence.load();

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // load() — file fallback
  // -------------------------------------------------------------------------

  describe('load() via file fallback (keychain unavailable)', () => {
    beforeEach(() => {
      mockKeytar.getPassword.mockRejectedValue(new Error('keychain unavailable'));
    });

    it('reads from the file when keychain throws', async () => {
      const raw = JSON.stringify({
        accessToken: 'at',
        scope: 'entities:read notes:read notes:write',
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(raw);

      const result = await persistence.load();

      expect(result).not.toBeNull();
      expect(result!.cache.accessToken).toBe('at');
      expect(result!.scope).toBe('entities:read notes:read notes:write');
    });

    it('returns null when the file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await persistence.load();

      expect(result).toBeNull();
    });

    it('returns null when the file is malformed', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('not-valid-json');

      const result = await persistence.load();

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // clear()
  // -------------------------------------------------------------------------

  describe('clear()', () => {
    it('deletes the keychain entry', async () => {
      mockKeytar.deletePassword.mockResolvedValue(undefined);
      mockFs.existsSync.mockReturnValue(false);

      await persistence.clear();

      expect(mockKeytar.deletePassword).toHaveBeenCalledTimes(1);
    });

    it('removes the fallback file when it exists', async () => {
      mockKeytar.deletePassword.mockResolvedValue(undefined);
      mockFs.existsSync.mockReturnValue(true);

      await persistence.clear();

      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('does not throw if keychain deletion fails', async () => {
      mockKeytar.deletePassword.mockRejectedValue(new Error('keychain error'));
      mockFs.existsSync.mockReturnValue(false);

      await expect(persistence.clear()).resolves.not.toThrow();
    });

    it('does not throw if the file does not exist', async () => {
      mockKeytar.deletePassword.mockResolvedValue(undefined);
      mockFs.existsSync.mockReturnValue(false);

      await expect(persistence.clear()).resolves.not.toThrow();
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });
});
