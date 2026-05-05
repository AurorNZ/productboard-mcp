import { SearchNotesTool } from '@tools/notes/search-notes';
import { ProductboardAPIClient } from '@api/index';
import { Logger } from '@utils/logger';

describe('SearchNotesTool', () => {
  let tool: SearchNotesTool;
  let mockApiClient: jest.Mocked<ProductboardAPIClient> & { post: jest.Mock; makeRequest: jest.Mock };
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockApiClient = {
      makeRequest: jest.fn(),
      post: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      getAllPages: jest.fn(),
    } as any;

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;

    tool = new SearchNotesTool(mockApiClient, mockLogger);
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('should initialize with correct name', () => {
      expect(tool.name).toBe('pb_note_search');
    });

    it('should initialize with correct description', () => {
      expect(tool.description).toContain('Search customer feedback notes');
    });

    it('should define correct parameters schema', () => {
      expect(tool.parameters).toMatchObject({
        type: 'object',
        properties: {
          type: { oneOf: expect.any(Array) },
          tags: { type: 'array', items: { type: 'string' } },
          owner_email: { type: 'string' },
          owner_id: { type: 'string' },
          creator_email: { type: 'string' },
          creator_id: { type: 'string' },
          archived: { type: 'boolean' },
          processed: { type: 'boolean' },
          created_from: { type: 'string', format: 'date-time' },
          created_to: { type: 'string', format: 'date-time' },
          updated_from: { type: 'string', format: 'date-time' },
          updated_to: { type: 'string', format: 'date-time' },
          customer_id: { type: 'string' },
          feature_id: { type: 'string' },
          source_system: { type: 'string' },
          source_record_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 20 },
          resolve_entities: { type: 'boolean', default: true },
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Build a minimal mock note */
  function makeNote(overrides: Record<string, unknown> = {}): any {
    return {
      id: 'note-1',
      type: 'textNote',
      fields: {
        name: 'Test Note',
        content: 'Some feedback',
        owner: { email: 'owner@example.com' },
        tags: [],
      },
      createdAt: '2025-01-15T00:00:00Z',
      relationships: { data: [] },
      links: { html: 'https://myorg.productboard.com/notes/note-1' },
      ...overrides,
    };
  }

  /** Wire a single-page POST /notes/search response */
  function mockSinglePage(notes: any[]): void {
    mockApiClient.post.mockResolvedValue({ data: notes, links: {} });
  }

  // ---------------------------------------------------------------------------
  // Request body construction
  // ---------------------------------------------------------------------------
  describe('request body construction', () => {
    it('should POST to /notes/search with an empty filter when no params given', async () => {
      mockSinglePage([]);

      await tool.execute({});

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/notes/search',
        { data: { filter: {} } },
        expect.anything(),
      );
    });

    it('should include type filter when type is a string', async () => {
      mockSinglePage([]);

      await tool.execute({ type: 'textNote' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.type).toBe('textNote');
    });

    it('should include type filter when type is an array', async () => {
      mockSinglePage([]);

      await tool.execute({ type: ['textNote', 'conversationNote'] });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.type).toEqual(['textNote', 'conversationNote']);
    });

    it('should include tag filter mapped to array of name objects', async () => {
      mockSinglePage([]);

      await tool.execute({ tags: ['bug', 'ux'] });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.fields.tag).toEqual([{ name: 'bug' }, { name: 'ux' }]);
    });

    it('should not include tag filter when tags array is empty', async () => {
      mockSinglePage([]);

      await tool.execute({ tags: [] });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.fields?.tag).toBeUndefined();
    });

    it('should filter by owner_email', async () => {
      mockSinglePage([]);

      await tool.execute({ owner_email: 'owner@example.com' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.fields.owner).toEqual({ email: 'owner@example.com' });
    });

    it('should prefer owner_id over owner_email when both provided', async () => {
      mockSinglePage([]);

      await tool.execute({ owner_id: 'user-123', owner_email: 'owner@example.com' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.fields.owner).toEqual({ id: 'user-123' });
    });

    it('should filter by creator_email', async () => {
      mockSinglePage([]);

      await tool.execute({ creator_email: 'creator@example.com' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.fields.creator).toEqual({ email: 'creator@example.com' });
    });

    it('should prefer creator_id over creator_email when both provided', async () => {
      mockSinglePage([]);

      await tool.execute({ creator_id: 'user-456', creator_email: 'creator@example.com' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.fields.creator).toEqual({ id: 'user-456' });
    });

    it('should include archived filter in fields', async () => {
      mockSinglePage([]);

      await tool.execute({ archived: true });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.fields.archived).toBe(true);
    });

    it('should include processed filter in fields', async () => {
      mockSinglePage([]);

      await tool.execute({ processed: false });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.fields.processed).toBe(false);
    });

    it('should include createdAt range filter', async () => {
      mockSinglePage([]);

      await tool.execute({
        created_from: '2025-01-01T00:00:00Z',
        created_to: '2025-01-31T23:59:59Z',
      });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.createdAt).toEqual({
        from: '2025-01-01T00:00:00Z',
        to: '2025-01-31T23:59:59Z',
      });
    });

    it('should include only created_from when created_to is absent', async () => {
      mockSinglePage([]);

      await tool.execute({ created_from: '2025-06-01T00:00:00Z' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.createdAt).toEqual({ from: '2025-06-01T00:00:00Z' });
    });

    it('should include updatedAt range filter', async () => {
      mockSinglePage([]);

      await tool.execute({
        updated_from: '2025-02-01T00:00:00Z',
        updated_to: '2025-02-28T23:59:59Z',
      });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.updatedAt).toEqual({
        from: '2025-02-01T00:00:00Z',
        to: '2025-02-28T23:59:59Z',
      });
    });

    it('should include customer relationship filter', async () => {
      mockSinglePage([]);

      await tool.execute({ customer_id: 'cust-abc' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.relationships.customer).toEqual({ id: 'cust-abc' });
    });

    it('should include feature link relationship filter', async () => {
      mockSinglePage([]);

      await tool.execute({ feature_id: 'feat-xyz' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.relationships.link).toEqual({ id: 'feat-xyz' });
    });

    it('should include metadata source system filter', async () => {
      mockSinglePage([]);

      await tool.execute({ source_system: 'zendesk' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.metadata).toEqual({ source: [{ system: 'zendesk' }] });
    });

    it('should include metadata source record ID filter', async () => {
      mockSinglePage([]);

      await tool.execute({ source_record_id: 'zd-100' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.metadata).toEqual({ source: [{ recordId: 'zd-100' }] });
    });

    it('should combine source_system and source_record_id in same metadata entry', async () => {
      mockSinglePage([]);

      await tool.execute({ source_system: 'intercom', source_record_id: 'ic-999' });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.metadata).toEqual({
        source: [{ system: 'intercom', recordId: 'ic-999' }],
      });
    });

    it('should combine multiple filter types in one request body', async () => {
      mockSinglePage([]);

      await tool.execute({
        type: 'textNote',
        tags: ['ux'],
        owner_email: 'pm@example.com',
        created_from: '2025-01-01T00:00:00Z',
        feature_id: 'feat-1',
      });

      const body = mockApiClient.post.mock.calls[0][1];
      expect(body.data.filter.type).toBe('textNote');
      expect(body.data.filter.fields.tag).toEqual([{ name: 'ux' }]);
      expect(body.data.filter.fields.owner).toEqual({ email: 'pm@example.com' });
      expect(body.data.filter.createdAt).toEqual({ from: '2025-01-01T00:00:00Z' });
      expect(body.data.filter.relationships.link).toEqual({ id: 'feat-1' });
    });
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------
  describe('pagination', () => {
    it('should stop after the first page when there is no next link', async () => {
      mockSinglePage([makeNote()]);

      await tool.execute({});

      expect(mockApiClient.post).toHaveBeenCalledTimes(1);
    });

    it('should follow pageCursor to fetch the next page', async () => {
      mockApiClient.post
        .mockResolvedValueOnce({
          data: [makeNote({ id: 'note-p1' })],
          links: { next: 'https://api.productboard.com/notes/search?pageCursor=cursor-abc' },
        })
        .mockResolvedValueOnce({
          data: [makeNote({ id: 'note-p2' })],
          links: {},
        });

      const result = await tool.execute({ limit: 10 });

      expect(mockApiClient.post).toHaveBeenCalledTimes(2);
      // Second call should include pageCursor as query param
      expect(mockApiClient.post).toHaveBeenNthCalledWith(
        2,
        '/notes/search',
        expect.anything(),
        { params: { pageCursor: 'cursor-abc' } },
      );
      expect(result.content[0].text).toContain('note-p1');
      expect(result.content[0].text).toContain('note-p2');
    });

    it('should stop early once the limit is reached mid-pagination', async () => {
      mockApiClient.post
        .mockResolvedValueOnce({
          data: [makeNote({ id: 'note-1' }), makeNote({ id: 'note-2' })],
          links: { next: 'https://api.productboard.com/notes/search?pageCursor=cursor-next' },
        })
        .mockResolvedValueOnce({
          data: [makeNote({ id: 'note-3' })],
          links: {},
        });

      const result = await tool.execute({ limit: 2 });

      // Should stop after first page because limit=2 is already satisfied
      expect(mockApiClient.post).toHaveBeenCalledTimes(1);
      expect(result.content[0].text).toContain('Found 2 note(s)');
    });

    it('should stop when an empty data array is returned', async () => {
      mockApiClient.post.mockResolvedValue({ data: [], links: {} });

      const result = await tool.execute({});

      expect(mockApiClient.post).toHaveBeenCalledTimes(1);
      expect(result.content[0].text).toBe('No notes found matching the search criteria.');
    });

    it('should slice results to the requested limit', async () => {
      const notes = Array.from({ length: 5 }, (_, i) => makeNote({ id: `note-${i}` }));
      mockSinglePage(notes);

      const result = await tool.execute({ limit: 3 });

      expect(result.content[0].text).toContain('Found 3 note(s)');
    });
  });

  // ---------------------------------------------------------------------------
  // Response formatting
  // ---------------------------------------------------------------------------
  describe('response formatting', () => {
    it('should return MCP content wrapper with type text', async () => {
      mockSinglePage([makeNote()]);

      const result = await tool.execute({});

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    it('should include note ID, type, owner, and content in summary', async () => {
      mockSinglePage([makeNote()]);

      const result = await tool.execute({});

      const text: string = result.content[0].text;
      expect(text).toContain('ID: note-1');
      expect(text).toContain('Type: textNote');
      expect(text).toContain('Owner: owner@example.com');
      expect(text).toContain('Content: Some feedback');
    });

    it('should include created date when present', async () => {
      mockSinglePage([makeNote()]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Created: 2025-01-15T00:00:00Z');
    });

    it('should omit type line when type field is absent', async () => {
      const noteNoType = makeNote();
      delete noteNoType.type;
      mockSinglePage([noteNoType]);

      const result = await tool.execute({});

      expect(result.content[0].text).not.toContain('Type:');
    });

    it('should omit created line when createdAt is absent', async () => {
      const noteNoDate = makeNote();
      delete noteNoDate.createdAt;
      mockSinglePage([noteNoDate]);

      const result = await tool.execute({});

      expect(result.content[0].text).not.toContain('Created:');
    });

    it('should show "Unknown" when owner email is absent', async () => {
      mockSinglePage([makeNote({ fields: { content: 'Feedback', owner: {}, tags: [] } })]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Owner: Unknown');
    });

    it('should show tags when present', async () => {
      mockSinglePage([
        makeNote({ fields: { content: 'Feedback', owner: { email: 'a@b.com' }, tags: [{ name: 'ux' }, { name: 'bug' }] } }),
      ]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Tags: ux, bug');
    });

    it('should show "None" when there are no tags', async () => {
      mockSinglePage([makeNote()]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Tags: None');
    });

    it('should include Productboard URL when present', async () => {
      mockSinglePage([makeNote()]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('URL: https://myorg.productboard.com/notes/note-1');
    });

    it('should omit URL line when links.html is absent', async () => {
      mockSinglePage([makeNote({ links: {} })]);

      const result = await tool.execute({});

      expect(result.content[0].text).not.toContain('URL:');
    });

    it('should use name field as title', async () => {
      mockSinglePage([makeNote()]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Test Note');
    });

    it('should fall back to first 60 chars of content as title when name is absent', async () => {
      const note = makeNote({
        fields: { content: 'Customer wants dark mode in their dashboard', owner: { email: 'a@b.com' }, tags: [] },
      });
      delete note.fields.name;
      mockSinglePage([note]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Customer wants dark mode in their dashboard');
    });

    it('should log info on execute', async () => {
      mockSinglePage([]);

      await tool.execute({});

      expect(mockLogger.info).toHaveBeenCalledWith('Searching notes');
    });

    it('should handle API errors gracefully', async () => {
      mockApiClient.post.mockRejectedValue(new Error('Network failure'));

      const result = await tool.execute({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Content extraction
  // ---------------------------------------------------------------------------
  describe('content extraction', () => {
    it('should strip HTML tags from plain text content', async () => {
      mockSinglePage([makeNote({ fields: { content: '<p>Hello <strong>world</strong></p>', owner: { email: 'a@b.com' }, tags: [] } })]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Hello world');
      expect(result.content[0].text).not.toContain('<p>');
      expect(result.content[0].text).not.toContain('<strong>');
    });

    it('should decode HTML entities in content', async () => {
      mockSinglePage([makeNote({ fields: { content: 'Price &lt; $10 &amp; tax &gt; $1', owner: { email: 'a@b.com' }, tags: [] } })]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Price < $10 & tax > $1');
    });

    it('should format conversationNote content with author prefixes', async () => {
      mockSinglePage([
        makeNote({
          fields: {
            content: [
              { authorName: 'Alice', content: 'Hello there' },
              { authorName: 'Bob', content: 'Hi back' },
            ],
            owner: { email: 'a@b.com' },
            tags: [],
          },
        }),
      ]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('[Alice]: Hello there');
      expect(result.content[0].text).toContain('[Bob]: Hi back');
    });

    it('should fall back to authorType when authorName is absent', async () => {
      mockSinglePage([
        makeNote({
          fields: {
            content: [{ authorType: 'customer', content: 'I need help' }],
            owner: { email: 'a@b.com' },
            tags: [],
          },
        }),
      ]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('[customer]: I need help');
    });

    it('should fall back to "Unknown" author when both authorName and authorType are absent', async () => {
      mockSinglePage([
        makeNote({
          fields: {
            content: [{ content: 'Anonymous message' }],
            owner: { email: 'a@b.com' },
            tags: [],
          },
        }),
      ]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('[Unknown]: Anonymous message');
    });

    it('should return empty content string when content field is absent', async () => {
      mockSinglePage([makeNote({ fields: { owner: { email: 'a@b.com' }, tags: [] } })]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Content: ');
    });
  });

  // ---------------------------------------------------------------------------
  // Company extraction
  // ---------------------------------------------------------------------------
  describe('company extraction', () => {
    it('should show company name from relationship target when available', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'customer', target: { type: 'company', id: 'co-1', name: 'Acme Corp' } }],
          },
        }),
      ]);

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Company: Acme Corp');
    });

    it('should resolve company ID to name via /entities/{id} when name is absent', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'customer', target: { type: 'company', id: 'co-unknown' } }],
          },
        }),
      ]);
      mockApiClient.makeRequest.mockResolvedValue({ data: { fields: { name: 'Resolved Corp' } } });

      const result = await tool.execute({});

      expect(mockApiClient.makeRequest).toHaveBeenCalledWith({
        method: 'GET',
        endpoint: '/entities/co-unknown',
      });
      expect(result.content[0].text).toContain('Company: Resolved Corp');
    });

    it('should fall back to domain when entity API returns domain instead of name', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'customer', target: { type: 'company', id: 'co-domain' } }],
          },
        }),
      ]);
      mockApiClient.makeRequest.mockResolvedValue({ data: { fields: { domain: 'acme.com' } } });

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Company: acme.com');
    });

    it('should fall back to "ID: <id>" when entity API call fails', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'customer', target: { type: 'company', id: 'co-fail' } }],
          },
        }),
      ]);
      mockApiClient.makeRequest.mockRejectedValue(new Error('Not found'));

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Company: ID: co-fail');
    });

    it('should omit Company line when no customer relationship exists', async () => {
      mockSinglePage([makeNote()]);

      const result = await tool.execute({});

      expect(result.content[0].text).not.toContain('Company:');
    });

    it('should batch-resolve company IDs without duplicate API calls', async () => {
      mockSinglePage([
        makeNote({ id: 'note-a', relationships: { data: [{ type: 'customer', target: { type: 'company', id: 'shared-co' } }] } }),
        makeNote({ id: 'note-b', relationships: { data: [{ type: 'customer', target: { type: 'company', id: 'shared-co' } }] } }),
      ]);
      mockApiClient.makeRequest.mockResolvedValue({ data: { fields: { name: 'Shared Corp' } } });

      await tool.execute({});

      // Only one entity API call despite two notes referencing the same company
      expect(mockApiClient.makeRequest).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Feature resolution
  // ---------------------------------------------------------------------------
  describe('feature resolution', () => {
    it('should resolve linked feature IDs to names and URLs', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'link', target: { type: 'feature', id: 'feat-abc' } }],
          },
        }),
      ]);
      mockApiClient.makeRequest.mockResolvedValue({
        data: {
          fields: { name: 'Dark Mode Support' },
          links: { html: 'https://myorg.productboard.com/feature/feat-abc' },
        },
      });

      const result = await tool.execute({});

      expect(mockApiClient.makeRequest).toHaveBeenCalledWith({
        method: 'GET',
        endpoint: '/entities/feat-abc',
      });
      expect(result.content[0].text).toContain(
        'Linked features: Dark Mode Support (https://myorg.productboard.com/feature/feat-abc)',
      );
    });

    it('should show feature name without URL when links.html is absent', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'link', target: { type: 'feature', id: 'feat-no-url' } }],
          },
        }),
      ]);
      mockApiClient.makeRequest.mockResolvedValue({
        data: { fields: { name: 'Feature Without URL' }, links: {} },
      });

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Linked features: Feature Without URL');
      expect(result.content[0].text).not.toContain('(http');
    });

    it('should fall back to raw feature ID when resolution API call fails', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'link', target: { type: 'feature', id: 'feat-fail' } }],
          },
        }),
      ]);
      mockApiClient.makeRequest.mockRejectedValue(new Error('Not found'));

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Linked features: feat-fail');
    });

    it('should fall back to raw ID when entity response has no name', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'link', target: { type: 'feature', id: 'feat-no-name' } }],
          },
        }),
      ]);
      mockApiClient.makeRequest.mockResolvedValue({ data: { fields: {}, links: {} } });

      const result = await tool.execute({});

      expect(result.content[0].text).toContain('Linked features: feat-no-name');
    });

    it('should batch-resolve feature IDs without duplicate API calls', async () => {
      mockSinglePage([
        makeNote({ id: 'note-a', relationships: { data: [{ type: 'link', target: { type: 'feature', id: 'shared-feat' } }] } }),
        makeNote({ id: 'note-b', relationships: { data: [{ type: 'link', target: { type: 'feature', id: 'shared-feat' } }] } }),
      ]);
      mockApiClient.makeRequest.mockResolvedValue({
        data: { fields: { name: 'Shared Feature' }, links: { html: 'https://example.com' } },
      });

      await tool.execute({});

      // Only one entity API call despite two notes referencing the same feature
      expect(mockApiClient.makeRequest).toHaveBeenCalledTimes(1);
    });

    it('should resolve multiple different linked features in parallel', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [
              { type: 'link', target: { type: 'feature', id: 'feat-1' } },
              { type: 'link', target: { type: 'feature', id: 'feat-2' } },
            ],
          },
        }),
      ]);
      mockApiClient.makeRequest
        .mockResolvedValueOnce({ data: { fields: { name: 'Feature One' }, links: {} } })
        .mockResolvedValueOnce({ data: { fields: { name: 'Feature Two' }, links: {} } });

      const result = await tool.execute({});

      expect(mockApiClient.makeRequest).toHaveBeenCalledTimes(2);
      expect(result.content[0].text).toContain('Feature One');
      expect(result.content[0].text).toContain('Feature Two');
    });

    it('should omit Linked features line when no feature links exist', async () => {
      mockSinglePage([makeNote()]);

      const result = await tool.execute({});

      expect(result.content[0].text).not.toContain('Linked features:');
    });
  });

  // ---------------------------------------------------------------------------
  // resolve_entities flag
  // ---------------------------------------------------------------------------
  describe('resolve_entities flag', () => {
    it('should skip entity resolution when resolve_entities is false', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [
              { type: 'customer', target: { type: 'company', id: 'co-skip' } },
              { type: 'link', target: { type: 'feature', id: 'feat-skip' } },
            ],
          },
        }),
      ]);

      await tool.execute({ resolve_entities: false });

      expect(mockApiClient.makeRequest).not.toHaveBeenCalled();
    });

    it('should show raw feature ID (not resolved name) when resolve_entities is false', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'link', target: { type: 'feature', id: 'feat-raw' } }],
          },
        }),
      ]);

      const result = await tool.execute({ resolve_entities: false });

      expect(result.content[0].text).toContain('feat-raw');
      expect(mockApiClient.makeRequest).not.toHaveBeenCalled();
    });

    it('should perform entity resolution by default (resolve_entities omitted)', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'customer', target: { type: 'company', id: 'co-default' } }],
          },
        }),
      ]);
      mockApiClient.makeRequest.mockResolvedValue({ data: { fields: { name: 'Default Corp' } } });

      const result = await tool.execute({});

      expect(mockApiClient.makeRequest).toHaveBeenCalled();
      expect(result.content[0].text).toContain('Company: Default Corp');
    });

    it('should perform entity resolution when resolve_entities is explicitly true', async () => {
      mockSinglePage([
        makeNote({
          relationships: {
            data: [{ type: 'customer', target: { type: 'company', id: 'co-explicit' } }],
          },
        }),
      ]);
      mockApiClient.makeRequest.mockResolvedValue({ data: { fields: { name: 'Explicit Corp' } } });

      const result = await tool.execute({ resolve_entities: true });

      expect(mockApiClient.makeRequest).toHaveBeenCalled();
      expect(result.content[0].text).toContain('Company: Explicit Corp');
    });
  });

  // ---------------------------------------------------------------------------
  // Parameter validation
  // ---------------------------------------------------------------------------
  describe('parameter validation', () => {
    it('should reject limit below minimum (0)', async () => {
      await expect(tool.execute({ limit: 0 })).rejects.toThrow('Invalid parameters');
    });

    it('should reject limit above maximum (501)', async () => {
      await expect(tool.execute({ limit: 501 })).rejects.toThrow('Invalid parameters');
    });

    it('should accept limit at boundary values (1 and 500)', async () => {
      mockSinglePage([makeNote()]);

      await expect(tool.execute({ limit: 1 })).resolves.not.toThrow();

      mockSinglePage([makeNote()]);
      await expect(tool.execute({ limit: 500 })).resolves.not.toThrow();
    });
  });
});
