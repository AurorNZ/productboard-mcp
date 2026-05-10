import { BaseTool } from '../base.js';
import { ProductboardAPIClient } from '@api/index.js';
import { Logger } from '@utils/logger.js';
import { Permission, AccessLevel } from '@auth/permissions.js';

interface SearchNotesParams {
  type?: string | string[];
  tags?: string[];
  owner_email?: string;
  owner_id?: string;
  creator_email?: string;
  creator_id?: string;
  archived?: boolean;
  processed?: boolean;
  created_from?: string;
  created_to?: string;
  updated_from?: string;
  updated_to?: string;
  customer_id?: string;
  feature_id?: string;
  source_system?: string;
  source_record_id?: string;
  limit?: number;
  resolve_entities?: boolean;
}

interface ResolvedFeature {
  name: string;
  url: string | null;
}

export class SearchNotesTool extends BaseTool<SearchNotesParams> {
  constructor(apiClient: ProductboardAPIClient, logger: Logger) {
    super(
      'pb_note_search',
      'Search customer feedback notes using structured filters (tags, linked features, customers, date ranges, note type). Default limit is 20, suitable for targeted lookups. For analysis or counting tasks that require complete data (e.g. "how many notes have no tags"), use limit: 500 with resolve_entities: false.',
      {
        type: 'object',
        properties: {
          type: {
            oneOf: [
              { type: 'string', enum: ['textNote', 'conversationNote', 'opportunityNote'] },
              {
                type: 'array',
                items: { type: 'string', enum: ['textNote', 'conversationNote', 'opportunityNote'] },
              },
            ],
            description: 'Filter by note type(s). Multiple values use OR logic.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter notes that have any of these tag names (OR logic)',
          },
          owner_email: {
            type: 'string',
            description: 'Filter by owner email address',
          },
          owner_id: {
            type: 'string',
            description: 'Filter by owner member ID',
          },
          creator_email: {
            type: 'string',
            description: 'Filter by creator email address',
          },
          creator_id: {
            type: 'string',
            description: 'Filter by creator member ID',
          },
          archived: {
            type: 'boolean',
            description: 'Filter by archived state',
          },
          processed: {
            type: 'boolean',
            description: 'Filter by processed state',
          },
          created_from: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes created from this date-time (ISO 8601)',
          },
          created_to: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes created up to this date-time (ISO 8601)',
          },
          updated_from: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes updated from this date-time (ISO 8601)',
          },
          updated_to: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes updated up to this date-time (ISO 8601)',
          },
          customer_id: {
            type: 'string',
            description: 'Filter notes linked to this customer entity ID (user or company)',
          },
          feature_id: {
            type: 'string',
            description: 'Filter notes linked to this feature ID',
          },
          source_system: {
            type: 'string',
            description: 'Filter by metadata source system name',
          },
          source_record_id: {
            type: 'string',
            description: 'Filter by metadata source record ID',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            default: 20,
            description: 'Number of notes to return (default 20 for targeted lookups). For analysis or counting tasks that require complete data, use 500 with resolve_entities: false.',
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

  private async resolveEntityName(id: string): Promise<string | null> {
    try {
      const response = await this.apiClient.makeRequest({ method: 'GET', endpoint: `/entities/${encodeURIComponent(id)}` });
      const fields = (response as any)?.data?.fields ?? (response as any)?.fields ?? (response as any)?.data ?? response;
      return (fields as any)?.name ?? (fields as any)?.domain ?? null;
    } catch {
      return null;
    }
  }

  private async resolveFeature(id: string): Promise<ResolvedFeature | null> {
    try {
      const response = await this.apiClient.makeRequest({ method: 'GET', endpoint: `/entities/${encodeURIComponent(id)}` });
      const data = (response as any)?.data ?? response;
      const name = data?.fields?.name ?? null;
      if (!name) return null;
      const url = data?.links?.html ?? null;
      return { name, url };
    } catch {
      return null;
    }
  }

  private buildRequestBody(params: SearchNotesParams): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    if (params.type !== undefined) {
      filter.type = params.type;
    }

    const createdAt: Record<string, string> = {};
    if (params.created_from) createdAt.from = params.created_from;
    if (params.created_to) createdAt.to = params.created_to;
    if (Object.keys(createdAt).length > 0) filter.createdAt = createdAt;

    const updatedAt: Record<string, string> = {};
    if (params.updated_from) updatedAt.from = params.updated_from;
    if (params.updated_to) updatedAt.to = params.updated_to;
    if (Object.keys(updatedAt).length > 0) filter.updatedAt = updatedAt;

    const fields: Record<string, unknown> = {};

    if (params.owner_email || params.owner_id) {
      fields.owner = params.owner_id ? { id: params.owner_id } : { email: params.owner_email };
    }
    if (params.creator_email || params.creator_id) {
      fields.creator = params.creator_id ? { id: params.creator_id } : { email: params.creator_email };
    }
    if (params.tags && params.tags.length > 0) {
      fields.tag = params.tags.map((name) => ({ name }));
    }
    if (params.archived !== undefined) fields.archived = params.archived;
    if (params.processed !== undefined) fields.processed = params.processed;

    if (Object.keys(fields).length > 0) filter.fields = fields;

    if (params.source_system || params.source_record_id) {
      const sourceEntry: Record<string, string> = {};
      if (params.source_system) sourceEntry.system = params.source_system;
      if (params.source_record_id) sourceEntry.recordId = params.source_record_id;
      filter.metadata = { source: [sourceEntry] };
    }

    const relationships: Record<string, unknown> = {};
    if (params.customer_id) {
      relationships.customer = { id: params.customer_id };
    }
    if (params.feature_id) {
      relationships.link = { id: params.feature_id };
    }
    if (Object.keys(relationships).length > 0) filter.relationships = relationships;

    return { data: { filter } };
  }

  private async getAllSearchPages(body: Record<string, unknown>, limit: number): Promise<any[]> {
    const allNotes: any[] = [];
    let pageCursor: string | undefined;
    const maxPages = 50;

    for (let page = 0; page < maxPages; page++) {
      const params = pageCursor ? { pageCursor } : undefined;
      const response = await this.apiClient.post<any>('/notes/search', body, { params });

      const data: any[] = response?.data ?? [];
      allNotes.push(...data);

      if (allNotes.length >= limit) break;
      if (data.length === 0) break;

      const nextUrl: string | undefined = response?.links?.next;
      if (!nextUrl) break;

      const parsed = new URL(nextUrl);
      pageCursor = parsed.searchParams.get('pageCursor') ?? undefined;
      if (!pageCursor) break;
    }

    return allNotes;
  }

  protected async executeInternal(params: SearchNotesParams = {}): Promise<unknown> {
    this.logger.info('Searching notes');

    const limit = params.limit ?? 20;
    const shouldResolve = params.resolve_entities !== false;
    const body = this.buildRequestBody(params);
    const allNotes = await this.getAllSearchPages(body, limit);
    const notes = allNotes.slice(0, limit);

    const stripHtml = (s: unknown): string =>
      String(s)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();

    const extractContent = (fields: any): string => {
      if (typeof fields?.content === 'string') {
        return stripHtml(fields.content);
      } else if (Array.isArray(fields?.content)) {
        return fields.content
          .map((part: any) => {
            // Quote the author name to prevent format spoofing via PB-supplied values.
            const who = part.authorName ?? part.authorType ?? 'Unknown';
            const text = stripHtml(String(part.content ?? ''));
            return `[PB note from "${who}"]: ${text}`;
          })
          .join(' | ');
      }
      return '';
    };

    const companyNames = new Map<string, string>();
    const resolvedFeatures = new Map<string, ResolvedFeature>();

    if (shouldResolve) {
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

    const extractCompany = (note: any): string | null => {
      const rels: any[] = note.relationships?.data ?? [];
      const customerRel = rels.find((r: any) => r.type === 'customer');
      if (customerRel?.target?.type === 'company') {
        const target = customerRel.target;
        return companyNames.get(target.id) ?? target.name ?? target.domain ?? `ID: ${target.id}`;
      }
      return null;
    };

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

    const formattedNotes = notes.map((note: any) => ({
      id: note.id,
      type: note.type,
      title: note.fields?.name || (extractContent(note.fields).substring(0, 60) || 'Untitled Note'),
      content: extractContent(note.fields),
      owner: note.fields?.owner?.email || 'Unknown',
      company: extractCompany(note),
      links: extractLinks(note),
      createdAt: note.createdAt,
      tags: (note.fields?.tags || []).map((t: any) => t?.name ?? t?.label ?? String(t)),
    }));

    // Warn when the limit was reached — there are likely more matching notes
    const truncationWarning = notes.length >= limit
      ? `⚠️ Result limit reached (${limit} notes returned). This may not represent all matching notes. For complete analysis, re-run with a higher limit (up to 500) and resolve_entities: false.\n\n`
      : '';

    const summary =
      formattedNotes.length > 0
        ? truncationWarning +
          `Found ${formattedNotes.length} note(s):\n\n` +
          formattedNotes
            .map(
              (n: any, i: number) =>
                `${i + 1}. ${n.title}\n` +
                `   ID: ${n.id}\n` +
                (n.type ? `   Type: ${n.type}\n` : '') +
                (n.createdAt ? `   Created: ${n.createdAt}\n` : '') +
                `   Owner: ${n.owner}\n` +
                (n.company ? `   Company: ${n.company}\n` : '') +
                `   Content: ${n.content}\n` +
                `   Tags: ${n.tags.length > 0 ? n.tags.join(', ') : 'None'}\n` +
                (n.links.html ? `   URL: ${n.links.html}\n` : '') +
                (n.links.features.length > 0
                  ? `   Linked features: ${n.links.features.map((f: any) => (f.url ? `${f.name} (${f.url})` : f.name)).join(', ')}\n`
                  : '')
            )
            .join('\n')
        : 'No notes found matching the search criteria.';

    return {
      content: [
        {
          type: 'text',
          text: summary,
        },
      ],
    };
  }
}
