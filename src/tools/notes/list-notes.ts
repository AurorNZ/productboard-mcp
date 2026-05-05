import { BaseTool } from '../base.js';
import { ProductboardAPIClient } from '@api/index.js';
import { Logger } from '@utils/logger.js';
import { Permission, AccessLevel } from '@auth/permissions.js';

interface ListNotesParams {
  processed?: boolean;
  archived?: boolean;
  owner_email?: string;
  owner_id?: string;
  creator_email?: string;
  creator_id?: string;
  source_record_id?: string;
  metadata_source_system?: string;
  metadata_source_record_id?: string;
  created_from?: string;
  created_to?: string;
  updated_from?: string;
  updated_to?: string;
  limit?: number;
  resolve_entities?: boolean;
}

interface ResolvedFeature {
  name: string;
  url: string | null;
}

export class ListNotesTool extends BaseTool<ListNotesParams> {
  constructor(apiClient: ProductboardAPIClient, logger: Logger) {
    super(
      'pb_note_list',
      'List customer feedback notes. Default limit is 20, suitable for browsing recent notes. For analysis, counting, or workspace-wide tasks (e.g. "how many notes have no tags"), use limit: 500 with resolve_entities: false to avoid timeouts.',
      {
        type: 'object',
        properties: {
          processed: {
            type: 'boolean',
            description: 'Filter by processed state',
          },
          archived: {
            type: 'boolean',
            description: 'Filter by archived state. Note: archived notes always return processed=false regardless of actual state',
          },
          owner_email: {
            type: 'string',
            description: 'Filter by owner email address',
          },
          owner_id: {
            type: 'string',
            description: 'Filter by owner ID',
          },
          creator_email: {
            type: 'string',
            description: 'Filter by creator email address',
          },
          creator_id: {
            type: 'string',
            description: 'Filter by creator ID',
          },
          source_record_id: {
            type: 'string',
            description: 'Filter by source record ID',
          },
          metadata_source_system: {
            type: 'string',
            description: 'Filter by metadata source system',
          },
          metadata_source_record_id: {
            type: 'string',
            description: 'Filter by metadata source record ID',
          },
          created_from: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes created from this date-time',
          },
          created_to: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes created up to this date-time',
          },
          updated_from: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes updated from this date-time',
          },
          updated_to: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes updated up to this date-time',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            default: 20,
            description: 'Number of notes to return (default 20 for browsing). For analysis or counting tasks that require complete data, use 500 with resolve_entities: false.',
          },
          resolve_entities: {
            type: 'boolean',
            default: true,
            description: 'When true (default), resolves company and feature IDs to display names — adds one API call per unique entity. Set to false when fetching large batches for search/scan purposes to avoid timeouts.',
          },
        },
      },
      {
        requiredPermissions: [Permission.NOTES_READ],
        minimumAccessLevel: AccessLevel.READ,
        description: 'Requires read access to notes',
      },
      apiClient,
      logger
    );
  }

  /** Resolve a company/entity ID to its display name via GET /entities/{id} */
  private async resolveEntityName(id: string): Promise<string | null> {
    try {
      const response = await this.apiClient.makeRequest({ method: 'GET', endpoint: `/entities/${id}` });
      const fields = (response as any)?.data?.fields ?? (response as any)?.fields ?? (response as any)?.data ?? response;
      return (fields as any)?.name ?? (fields as any)?.domain ?? null;
    } catch {
      return null;
    }
  }

  /** Resolve a feature ID to its name and URL via GET /entities/{id} */
  private async resolveFeature(id: string): Promise<ResolvedFeature | null> {
    try {
      const response = await this.apiClient.makeRequest({ method: 'GET', endpoint: `/entities/${id}` });
      const data = (response as any)?.data ?? response;
      const name = data?.fields?.name ?? null;
      if (!name) return null;
      const url = data?.links?.html ?? null;
      return { name, url };
    } catch {
      return null;
    }
  }

  protected async executeInternal(params: ListNotesParams = {}): Promise<unknown> {
    this.logger.info('Listing notes');

    const queryParams: Record<string, any> = {};

    if (params.processed !== undefined) queryParams.processed = params.processed;
    if (params.archived !== undefined) queryParams.archived = params.archived;
    if (params.owner_email) queryParams['owner[email]'] = params.owner_email;
    if (params.owner_id) queryParams['owner[id]'] = params.owner_id;
    if (params.creator_email) queryParams['creator[email]'] = params.creator_email;
    if (params.creator_id) queryParams['creator[id]'] = params.creator_id;
    if (params.source_record_id) queryParams['source[recordId]'] = params.source_record_id;
    if (params.metadata_source_system) queryParams['metadata[source][system]'] = params.metadata_source_system;
    if (params.metadata_source_record_id) queryParams['metadata[source][recordId]'] = params.metadata_source_record_id;
    if (params.created_from) queryParams.createdFrom = params.created_from;
    if (params.created_to) queryParams.createdTo = params.created_to;
    if (params.updated_from) queryParams.updatedFrom = params.updated_from;
    if (params.updated_to) queryParams.updatedTo = params.updated_to;

    const limit = params.limit || 20;
    const shouldResolve = params.resolve_entities !== false;
    const allNotes = await this.apiClient.getAllPages<any>('/notes', queryParams, { maxItems: limit });
    const notes = allNotes.slice(0, limit);

    const stripHtml = (s: unknown): string => String(s)
      .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

    // Content: string for textNote, array of parts for conversationNote
    const extractContent = (fields: any): string => {
      if (typeof fields?.content === 'string') {
        return stripHtml(fields.content);
      } else if (Array.isArray(fields?.content)) {
        return fields.content
          .map((part: any) => {
            const who = part.authorName ?? part.authorType ?? 'Unknown';
            const text = stripHtml(String(part.content ?? ''));
            return `[${who}]: ${text}`;
          })
          .join(' | ');
      }
      return '';
    };

    const companyNames = new Map<string, string>();
    const resolvedFeatures = new Map<string, ResolvedFeature>();

    if (shouldResolve) {
      // Collect unique company IDs that need resolving, then batch-resolve in parallel
      const companyIds: string[] = [
        ...new Set<string>(
          notes.flatMap((note: any) =>
            (note.relationships?.data ?? [])
              .filter((r: any) => r.type === 'customer' && r.target?.type === 'company' && !r.target.name)
              .map((r: any) => r.target.id as string)
          )
        ),
      ];
      await Promise.all(
        companyIds.map(async (id) => {
          const name = await this.resolveEntityName(id);
          if (name) companyNames.set(id, name);
        })
      );

      const featureIds: string[] = [
        ...new Set<string>(
          notes.flatMap((note: any) =>
            (note.relationships?.data ?? [])
              .filter((r: any) => r.type === 'link' && r.target?.type === 'feature')
              .map((r: any) => r.target.id as string)
          )
        ),
      ];
      await Promise.all(
        featureIds.map(async (id) => {
          const feature = await this.resolveFeature(id);
          if (feature) resolvedFeatures.set(id, feature);
        })
      );
    }

    // Extract company from relationships, resolving IDs to names where possible
    const extractCompany = (note: any): string | null => {
      const rels: any[] = note.relationships?.data ?? [];
      const customerRel = rels.find((r: any) => r.type === 'customer');
      if (customerRel?.target?.type === 'company') {
        const target = customerRel.target;
        return companyNames.get(target.id) ?? target.name ?? target.domain ?? `ID: ${target.id}`;
      }
      return null;
    };

    // Links: Productboard UI URL + linked features (resolved to name + url)
    const extractLinks = (note: any): { html: string | null; features: Array<{ id: string; name: string; url: string | null }> } => {
      const html = note.links?.html ?? null;
      const features = (note.relationships?.data ?? [])
        .filter((r: any) => r.type === 'link' && r.target?.type === 'feature')
        .map((r: any) => {
          const id = r.target.id as string;
          const resolved = resolvedFeatures.get(id);
          return { id, name: resolved?.name ?? id, url: resolved?.url ?? null };
        });
      return { html, features };
    };

    // Format response for MCP protocol
    const formattedNotes = notes.map((note: any) => ({
      id: note.id,
      title: note.fields?.name || (extractContent(note.fields).substring(0, 60) || 'Untitled Note'),
      content: extractContent(note.fields),
      owner: note.fields?.owner?.email || 'Unknown',
      company: extractCompany(note),
      links: extractLinks(note),
      createdAt: note.createdAt,
      tags: (note.fields?.tags || []).map((t: any) => t?.name ?? t?.label ?? String(t)),
    }));

    // Warn when the limit was reached — there are likely more notes in the workspace
    const truncationWarning = allNotes.length >= limit
      ? `⚠️ Result limit reached (${limit} notes returned). This may not represent all notes in the workspace. For complete analysis, re-run with a higher limit (up to 500) and resolve_entities: false.\n\n`
      : '';

    // Create a text summary of the notes
    const summary = formattedNotes.length > 0
      ? truncationWarning +
        `Showing ${formattedNotes.length} note(s):\n\n` +
        formattedNotes.map((n: any, i: number) =>
          `${i + 1}. ${n.title}\n` +
          `   ID: ${n.id}\n` +
          (n.createdAt ? `   Created: ${n.createdAt}\n` : '') +
          `   Owner: ${n.owner}\n` +
          (n.company ? `   Company: ${n.company}\n` : '') +
          `   Content: ${n.content}\n` +
          `   Tags: ${n.tags.length > 0 ? n.tags.join(', ') : 'None'}\n` +
          (n.links.html ? `   URL: ${n.links.html}\n` : '') +
          (n.links.features.length > 0
            ? `   Linked features: ${n.links.features.map((f: any) => f.url ? `${f.name} (${f.url})` : f.name).join(', ')}\n`
            : '')
        ).join('\n')
      : 'No notes found.';

    // Return in MCP expected format
    return {
      content: [
        {
          type: 'text',
          text: summary
        }
      ]
    };
  }
}
