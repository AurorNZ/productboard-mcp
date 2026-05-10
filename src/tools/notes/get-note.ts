import { BaseTool } from '../base.js';
import { ProductboardAPIClient } from '@api/client.js';
import { Logger } from '@utils/logger.js';
import { Permission, AccessLevel } from '@auth/permissions.js';

interface GetNoteParams {
  id: string;
}

interface ResolvedFeature {
  name: string;
  url: string | null;
}

export class GetNoteTool extends BaseTool<GetNoteParams> {
  constructor(apiClient: ProductboardAPIClient, logger: Logger) {
    super(
      'pb_note_get',
      'Get a customer feedback note by ID',
      {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'string',
            description: 'The Productboard note ID',
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

  protected async executeInternal(params: GetNoteParams): Promise<unknown> {
    this.logger.info('Getting note', { noteId: params.id });

    const response = await (this.apiClient as any).get(`/notes/${encodeURIComponent(params.id)}`);
    const note = (response as any)?.data ?? response;

    if (!note) {
      return { content: [{ type: 'text', text: `Note ${params.id} not found.` }] };
    }

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

    const fields = note.fields ?? {};
    const rels: any[] = note.relationships?.data ?? [];

    const company = (() => {
      const cr = rels.find((r: any) => r.type === 'customer');
      if (cr?.target?.type === 'company') {
        return cr.target.name ?? cr.target.domain ?? `ID: ${cr.target.id}`;
      }
      return null;
    })();

    // Resolve feature IDs to names in parallel
    const featureRels = rels.filter((r: any) => r.type === 'link' && r.target?.type === 'feature');
    const resolvedFeatures = new Map<string, ResolvedFeature>();
    await Promise.all(featureRels.map(async (r: any) => {
      const id: string = r.target.id;
      const resolved = await this.resolveFeature(id);
      if (resolved) resolvedFeatures.set(id, resolved);
    }));
    const features = featureRels.map((r: any) => {
      const id: string = r.target.id;
      const resolved = resolvedFeatures.get(id);
      const name = resolved?.name ?? id;
      const url = resolved?.url ?? null;
      return url ? `${name} (${url})` : name;
    });

    const tags = (fields.tags || []).map((t: any) => t?.name ?? t?.label ?? String(t));

    const lines = [
      `ID: ${note.id}`,
      `Title: ${fields.name || '(no title)'}`,
      note.createdAt ? `Created: ${note.createdAt}` : null,
      note.updatedAt ? `Updated: ${note.updatedAt}` : null,
      `Owner: ${fields.owner?.email ?? 'Unknown'}`,
      company ? `Company: ${company}` : null,
      `Content: ${extractContent(fields)}`,
      `Tags: ${tags.length > 0 ? tags.join(', ') : 'None'}`,
      note.links?.html ? `URL: ${note.links.html}` : null,
      features.length > 0 ? `Linked features: ${features.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return { content: [{ type: 'text', text: lines }] };
  }
}
