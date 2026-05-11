/**
 * Validates the structure and content of manifest.json.
 * These tests act as a guard against accidental config regressions.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), 'manifest.json'), 'utf8'),
);

describe('manifest.json', () => {
  describe('tools list', () => {
    const toolNames: string[] = (manifest?.tools ?? []).map((t: any) => t.name);

    it('should include all note tools', () => {
      expect(toolNames).toContain('pb_note_list');
      expect(toolNames).toContain('pb_note_get');
      expect(toolNames).toContain('pb_note_create');
      expect(toolNames).toContain('pb_note_search');
    });

    it('should include all feature tools', () => {
      expect(toolNames).toContain('pb_feature_list');
      expect(toolNames).toContain('pb_feature_get');
      expect(toolNames).toContain('pb_feature_create');
      expect(toolNames).toContain('pb_feature_update');
      expect(toolNames).toContain('pb_feature_delete');
    });

    it('each tool entry should have a name and description', () => {
      for (const tool of manifest.tools) {
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });

    it('all tool names should follow the pb_<resource>_<action> pattern', () => {
      for (const name of toolNames) {
        expect(name).toMatch(/^pb_[a-z]+(_[a-z]+)+$/);
      }
    });
  });

  describe('server env config', () => {
    const env: Record<string, string> = manifest?.server?.mcp_config?.env ?? {};

    it('should not contain SKIP_TOKEN_VALIDATION', () => {
      expect(Object.keys(env)).not.toContain('SKIP_TOKEN_VALIDATION');
    });

    it('should hardcode PRODUCTBOARD_AUTH_TYPE to oauth2', () => {
      expect(env['PRODUCTBOARD_AUTH_TYPE']).toBe('oauth2');
    });

    it('should hardcode PRODUCTBOARD_OAUTH_CLIENT_ID (not user-configurable)', () => {
      expect(env['PRODUCTBOARD_OAUTH_CLIENT_ID']).toBeDefined();
      expect(env['PRODUCTBOARD_OAUTH_CLIENT_ID']).not.toContain('user_config');
    });

    it('should reference PRODUCTBOARD_OAUTH_CLIENT_SECRET from user_config', () => {
      expect(env['PRODUCTBOARD_OAUTH_CLIENT_SECRET']).toContain('user_config');
    });

    it('should not expose PRODUCTBOARD_API_TOKEN in env (OAuth2-only bundle)', () => {
      expect(env['PRODUCTBOARD_API_TOKEN']).toBeUndefined();
    });

    it('should reference LOG_LEVEL', () => {
      expect(env['LOG_LEVEL']).toBeDefined();
    });

    it('should reference PRODUCTBOARD_FULL_ACCESS from user_config', () => {
      expect(env['PRODUCTBOARD_FULL_ACCESS']).toContain('user_config');
    });
  });

  describe('user_config', () => {
    it('should define PRODUCTBOARD_OAUTH_CLIENT_SECRET as required and sensitive', () => {
      const cfg = manifest?.user_config?.PRODUCTBOARD_OAUTH_CLIENT_SECRET;
      expect(cfg).toBeDefined();
      expect(cfg.required).toBe(true);
      expect(cfg.sensitive).toBe(true);
      expect(cfg.type).toBe('string');
    });

    it('should not expose PRODUCTBOARD_API_TOKEN to users (OAuth2-only bundle)', () => {
      expect(manifest?.user_config?.PRODUCTBOARD_API_TOKEN).toBeUndefined();
    });

    it('should define LOG_LEVEL as optional with default "error"', () => {
      const cfg = manifest?.user_config?.LOG_LEVEL;
      expect(cfg).toBeDefined();
      expect(cfg.required).toBe(false);
      expect(cfg.default).toBe('error');
    });

    it('should define PRODUCTBOARD_FULL_ACCESS as an optional boolean defaulting to false', () => {
      const cfg = manifest?.user_config?.PRODUCTBOARD_FULL_ACCESS;
      expect(cfg).toBeDefined();
      expect(cfg.type).toBe('boolean');
      expect(cfg.required).toBe(false);
      expect(cfg.default).toBe(false);
    });
  });

  describe('metadata', () => {
    it('should have a valid semver version', () => {
      expect(manifest?.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should declare all target platforms', () => {
      expect(manifest?.compatibility?.platforms).toEqual(
        expect.arrayContaining(['darwin', 'win32', 'linux']),
      );
    });

    it('should require Node.js >= 18', () => {
      const nodeReq: string = manifest?.compatibility?.runtimes?.node ?? '';
      expect(nodeReq).toMatch(/>=\s*18/);
    });

    it('should have MIT license', () => {
      expect(manifest?.license).toBe('MIT');
    });
  });
});
