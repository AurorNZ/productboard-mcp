import axios from 'axios';
import { ProductboardAPIClient } from '@api/client.js';
import { Logger } from '@utils/logger.js';
import { TokenInfoResponse } from './types.js';
import { AuthenticationManager } from './manager.js';
import {
  UserPermissions,
  AccessLevel,
  Permission,
} from './permissions.js';

const TOKEN_INFO_URL = 'https://app.productboard.com/oauth2/token/info';

export class PermissionDiscoveryService {
  private apiClient: ProductboardAPIClient;
  private logger: Logger;
  private authManager?: AuthenticationManager;

  constructor(apiClient: ProductboardAPIClient, logger: Logger, authManager?: AuthenticationManager) {
    this.apiClient = apiClient;
    this.logger = logger;
    this.authManager = authManager;
  }

  async discoverUserPermissions(): Promise<UserPermissions> {
    if (this.authManager) {
      const cache = this.authManager.getTokenCache();
      // If we have an OAuth2 access token, use the token info endpoint
      if (cache.accessToken) {
        return this.discoverFromTokenInfo(cache.accessToken);
      }
    }

    // Bearer token path: try JWT decode (PB tokens are not JWTs in practice,
    // so this falls through to read-only today)
    const tokenRole = this.extractRoleFromToken();
    if (tokenRole) {
      this.logger.info(`Discovered role from token: ${tokenRole}`);
      return this.createPermissionsFromRole(tokenRole);
    }

    this.logger.info("Skipping permission discovery - assuming read-only access");
    return this.createReadOnlyUserPermissions();
  }

  private async discoverFromTokenInfo(accessToken: string): Promise<UserPermissions> {
    try {
      const response = await axios.get<TokenInfoResponse>(TOKEN_INFO_URL, {
        params: { access_token: accessToken },
        timeout: 10_000,
      });

      const scopes = response.data.scopes ?? [];
      this.logger.info('Discovered OAuth2 scopes from token info', { scopes });
      return this.createPermissionsFromScopes(scopes);
    } catch (error) {
      this.logger.warn('OAuth2 token info request failed — assuming read-only access', error);
      return this.createReadOnlyUserPermissions();
    }
  }

  private createPermissionsFromScopes(scopes: string[]): UserPermissions {
    const hasEntitiesRead = scopes.includes('entities:read');
    const hasEntitiesWrite = scopes.includes('entities:write');
    const hasEntitiesDelete = scopes.includes('entities:delete');
    const hasNotesRead = scopes.includes('notes:read');
    const hasNotesWrite = scopes.includes('notes:write');
    const hasNotesDelete = scopes.includes('notes:delete');

    const canWrite = hasEntitiesWrite || hasNotesWrite;
    const canDelete = hasEntitiesDelete || hasNotesDelete;

    const permissions = new Set<Permission>();

    if (hasEntitiesRead) {
      permissions.add(Permission.FEATURES_READ);
      permissions.add(Permission.PRODUCTS_READ);
      permissions.add(Permission.OBJECTIVES_READ);
      permissions.add(Permission.RELEASES_READ);
    }
    if (hasNotesRead) permissions.add(Permission.NOTES_READ);

    if (hasEntitiesWrite) {
      permissions.add(Permission.FEATURES_WRITE);
      permissions.add(Permission.PRODUCTS_WRITE);
      permissions.add(Permission.OBJECTIVES_WRITE);
      permissions.add(Permission.RELEASES_WRITE);
    }
    if (hasNotesWrite) permissions.add(Permission.NOTES_WRITE);

    if (hasEntitiesDelete) {
      permissions.add(Permission.FEATURES_DELETE);
      permissions.add(Permission.PRODUCTS_DELETE);
      permissions.add(Permission.OBJECTIVES_DELETE);
      permissions.add(Permission.RELEASES_DELETE);
    }
    if (hasNotesDelete) permissions.add(Permission.NOTES_DELETE);

    const accessLevel = canDelete ? AccessLevel.ADMIN : canWrite ? AccessLevel.WRITE : AccessLevel.READ;

    return {
      permissions,
      accessLevel,
      isReadOnly: !canWrite,
      canWrite,
      canDelete,
      isAdmin: canDelete,
      capabilities: {
        features: { read: hasEntitiesRead, write: hasEntitiesWrite, delete: hasEntitiesDelete },
        products: { read: hasEntitiesRead, write: hasEntitiesWrite, delete: hasEntitiesDelete },
        notes: { read: hasNotesRead, write: hasNotesWrite, delete: hasNotesDelete },
        objectives: { read: hasEntitiesRead, write: hasEntitiesWrite, delete: hasEntitiesDelete },
        releases: { read: hasEntitiesRead, write: hasEntitiesWrite, delete: hasEntitiesDelete },
      },
    };
  }

  private extractRoleFromToken(): string | null {
    try {
      const config = this.apiClient.getConfig();
      const token = (config as any).token || process.env.PRODUCTBOARD_API_TOKEN;
      if (!token || typeof token !== 'string') return null;
      const parts = token.split('.');
      // PB tokens are not JWTs in practice — this falls through to read-only today.
      // IMPORTANT: even if PB issues JWTs in future, this decodes WITHOUT signature
      // verification. The role value only controls which tool *descriptions* Claude
      // sees; it is NOT a security boundary. Productboard's API enforces real
      // permissions on every call regardless of what is set here.
      if (parts.length !== 3) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      return payload.role || null;
    } catch {
      return null;
    }
  }

  private createPermissionsFromRole(role: string): UserPermissions {
    const isAdmin = role === 'admin';
    const canWrite = isAdmin || role === 'contributor' || role === 'editor';
    const canDelete = isAdmin;

    const permissions = new Set<Permission>();

    // All roles get read access
    permissions.add(Permission.FEATURES_READ);
    permissions.add(Permission.PRODUCTS_READ);
    permissions.add(Permission.NOTES_READ);
    permissions.add(Permission.OBJECTIVES_READ);
    permissions.add(Permission.RELEASES_READ);

    if (canWrite) {
      permissions.add(Permission.FEATURES_WRITE);
      permissions.add(Permission.PRODUCTS_WRITE);
      permissions.add(Permission.NOTES_WRITE);
      permissions.add(Permission.OBJECTIVES_WRITE);
      permissions.add(Permission.RELEASES_WRITE);
    }

    if (canDelete) {
      permissions.add(Permission.FEATURES_DELETE);
      permissions.add(Permission.PRODUCTS_DELETE);
      permissions.add(Permission.NOTES_DELETE);
      permissions.add(Permission.OBJECTIVES_DELETE);
      permissions.add(Permission.RELEASES_DELETE);
    }

    const accessLevel = isAdmin ? AccessLevel.ADMIN : canWrite ? AccessLevel.WRITE : AccessLevel.READ;

    return {
      permissions,
      accessLevel,
      isReadOnly: !canWrite,
      canWrite,
      canDelete,
      isAdmin,
      capabilities: {
        features: { read: true, write: canWrite, delete: canDelete },
        products: { read: true, write: canWrite, delete: canDelete },
        notes: { read: true, write: canWrite, delete: canDelete },
        objectives: { read: true, write: canWrite, delete: canDelete },
        releases: { read: true, write: canWrite, delete: canDelete },
      },
    };
  }

  private createReadOnlyUserPermissions(): UserPermissions {
    const permissions = new Set<Permission>();

    permissions.add(Permission.FEATURES_READ);
    permissions.add(Permission.PRODUCTS_READ);
    permissions.add(Permission.NOTES_READ);
    permissions.add(Permission.OBJECTIVES_READ);
    permissions.add(Permission.RELEASES_READ);

    return {
      permissions,
      accessLevel: AccessLevel.READ,
      isReadOnly: true,
      canWrite: false,
      canDelete: false,
      isAdmin: false,
      capabilities: {
        features: { read: true, write: false, delete: false },
        products: { read: true, write: false, delete: false },
        notes: { read: true, write: false, delete: false },
        objectives: { read: true, write: false, delete: false },
        releases: { read: true, write: false, delete: false },
      },
    };
  }
}
