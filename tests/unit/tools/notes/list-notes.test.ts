import { ListNotesTool } from '@tools/notes/list-notes';
import { ProductboardAPIClient } from '@api/index';
import { Logger } from '@utils/logger';

describe('ListNotesTool', () => {
  let tool: ListNotesTool;
  let mockApiClient: jest.Mocked<ProductboardAPIClient> & { getAllPages: jest.Mock };
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockApiClient = {
      makeRequest: jest.fn(),
      getAllPages: jest.fn(),
    } as any;

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;

    tool = new ListNotesTool(mockApiClient, mockLogger);
  });

  describe('constructor', () => {
    it('should initialize with correct name and description', () => {
      expect(tool.name).toBe('pb_note_list');
      expect(tool.description).toBe('List customer feedback notes');
    });

    it('should define correct parameters schema', () => {
      expect(tool.parameters).toMatchObject({
        type: 'object',
        properties: {
          processed: {
            type: 'boolean',
            description: 'Filter by processed state',
          },
          archived: {
            type: 'boolean',
            description: expect.stringContaining('archived'),
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
          },
        },
      });
    });
  });

  describe('execute', () => {
    const mockNotes = [
      {
        id: 'note-1',
        fields: {
          name: 'First note',
          content: 'First feedback',
          owner: { email: 'owner1@example.com' },
          tags: [],
        },
        createdAt: '2025-01-15T00:00:00Z',
        relationships: { data: [] },
        links: { html: 'https://example.productboard.com/notes/note-1' },
      },
      {
        id: 'note-2',
        fields: {
          name: 'Second note',
          content: 'Second feedback',
          owner: { email: 'owner2@example.com' },
          tags: ['bug'],
        },
        createdAt: '2025-01-14T00:00:00Z',
        relationships: { data: [] },
        links: {},
      },
    ];

    it('should list notes with default parameters', async () => {
      mockApiClient.getAllPages.mockResolvedValue(mockNotes);

      const result = await tool.execute({});

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', {}, { maxItems: 20 });

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Found 2 notes total, showing 2');
      expect(result.content[0].text).toContain('First note');
      expect(result.content[0].text).toContain('Second note');

      expect(mockLogger.info).toHaveBeenCalledWith('Listing notes');
    });

    it('should filter by processed', async () => {
      mockApiClient.getAllPages.mockResolvedValue(mockNotes);

      await tool.execute({ processed: true });

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', { processed: true }, { maxItems: 20 });
    });

    it('should filter by archived', async () => {
      mockApiClient.getAllPages.mockResolvedValue(mockNotes);

      await tool.execute({ archived: false });

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', { archived: false }, { maxItems: 20 });
    });

    it('should filter by owner_email', async () => {
      mockApiClient.getAllPages.mockResolvedValue([mockNotes[0]]);

      await tool.execute({ owner_email: 'owner1@example.com' });

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', { 'owner[email]': 'owner1@example.com' }, { maxItems: 20 });
    });

    it('should filter by owner_id', async () => {
      mockApiClient.getAllPages.mockResolvedValue([mockNotes[0]]);

      await tool.execute({ owner_id: 'user-123' });

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', { 'owner[id]': 'user-123' }, { maxItems: 20 });
    });

    it('should filter by creator_email', async () => {
      mockApiClient.getAllPages.mockResolvedValue([mockNotes[0]]);

      await tool.execute({ creator_email: 'creator@example.com' });

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', { 'creator[email]': 'creator@example.com' }, { maxItems: 20 });
    });

    it('should filter by creator_id', async () => {
      mockApiClient.getAllPages.mockResolvedValue([mockNotes[0]]);

      await tool.execute({ creator_id: 'creator-456' });

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', { 'creator[id]': 'creator-456' }, { maxItems: 20 });
    });

    it('should filter by source_record_id', async () => {
      mockApiClient.getAllPages.mockResolvedValue(mockNotes);

      await tool.execute({ source_record_id: 'src-789' });

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', { 'source[recordId]': 'src-789' }, { maxItems: 20 });
    });

    it('should filter by metadata source fields', async () => {
      mockApiClient.getAllPages.mockResolvedValue(mockNotes);

      await tool.execute({ metadata_source_system: 'zendesk', metadata_source_record_id: 'zd-100' });

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', {
        'metadata[source][system]': 'zendesk',
        'metadata[source][recordId]': 'zd-100',
      }, { maxItems: 20 });
    });

    it('should filter by created date range', async () => {
      mockApiClient.getAllPages.mockResolvedValue(mockNotes);

      await tool.execute({
        created_from: '2025-01-01T00:00:00Z',
        created_to: '2025-01-31T23:59:59Z',
      });

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', {
        createdFrom: '2025-01-01T00:00:00Z',
        createdTo: '2025-01-31T23:59:59Z',
      }, { maxItems: 20 });
    });

    it('should filter by updated date range', async () => {
      mockApiClient.getAllPages.mockResolvedValue(mockNotes);

      await tool.execute({
        updated_from: '2025-02-01T00:00:00Z',
        updated_to: '2025-02-28T23:59:59Z',
      });

      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', {
        updatedFrom: '2025-02-01T00:00:00Z',
        updatedTo: '2025-02-28T23:59:59Z',
      }, { maxItems: 20 });
    });

    it('should respect custom limit (client-side slice)', async () => {
      mockApiClient.getAllPages.mockResolvedValue(mockNotes);

      const result = await tool.execute({ limit: 1 });

      // maxItems passed to getAllPages to stop pagination early
      expect(mockApiClient.getAllPages).toHaveBeenCalledWith('/notes', {}, { maxItems: 1 });

      // Only 1 note returned due to limit
      expect(result.content[0].text).toContain('showing 1');
    });

    it('should handle pagination', async () => {
      mockApiClient.getAllPages.mockResolvedValue(mockNotes);

      const result = await tool.execute({});

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Found 2 notes total, showing 2');
    });

    it('should validate limit range', async () => {
      await expect(tool.execute({ limit: 0 })).rejects.toThrow('Invalid parameters');
      await expect(tool.execute({ limit: 501 })).rejects.toThrow('Invalid parameters');
    });

    it('should handle empty results', async () => {
      mockApiClient.getAllPages.mockResolvedValue([]);

      const result = await tool.execute({});

      expect(result.content[0].text).toBe('No notes found.');
    });

    it('should handle API errors', async () => {
      mockApiClient.getAllPages.mockRejectedValue(new Error('API Error'));

      const result = await tool.execute({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    });

    describe('content extraction', () => {
      it('should strip HTML from plain text content', async () => {
        const noteWithHtml = [{
          id: 'note-html',
          fields: { content: '<p>Hello <strong>world</strong></p>', tags: [] },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: { data: [] },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(noteWithHtml);

        const result = await tool.execute({});

        expect(result.content[0].text).toContain('Hello world');
        expect(result.content[0].text).not.toContain('<p>');
        expect(result.content[0].text).not.toContain('<strong>');
      });

      it('should format conversationNote content with author prefixes', async () => {
        const conversationNote = [{
          id: 'note-conv',
          fields: {
            content: [
              { authorName: 'Alice', content: 'Hello there' },
              { authorName: 'Bob', content: 'Hi back' },
            ],
            tags: [],
          },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: { data: [] },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(conversationNote);

        const result = await tool.execute({});

        expect(result.content[0].text).toContain('[Alice]: Hello there');
        expect(result.content[0].text).toContain('[Bob]: Hi back');
      });

      it('should fall back to authorType when authorName is absent', async () => {
        const conversationNote = [{
          id: 'note-conv2',
          fields: {
            content: [
              { authorType: 'customer', content: 'I need help' },
            ],
            tags: [],
          },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: { data: [] },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(conversationNote);

        const result = await tool.execute({});

        expect(result.content[0].text).toContain('[customer]: I need help');
      });
    });

    describe('company extraction', () => {
      it('should show company name from relationship target when available', async () => {
        const noteWithCompany = [{
          id: 'note-co',
          fields: { content: 'Feedback', tags: [] },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: {
            data: [{ type: 'customer', target: { type: 'company', id: 'co-1', name: 'Acme Corp' } }],
          },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(noteWithCompany);

        const result = await tool.execute({});

        expect(result.content[0].text).toContain('Company: Acme Corp');
      });

      it('should resolve company ID to name via API when name is absent', async () => {
        const noteWithCompanyId = [{
          id: 'note-co2',
          fields: { content: 'Feedback', tags: [] },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: {
            data: [{ type: 'customer', target: { type: 'company', id: 'co-unknown-id' } }],
          },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(noteWithCompanyId);
        mockApiClient.makeRequest.mockResolvedValue({ data: { fields: { name: 'Resolved Corp' } } });

        const result = await tool.execute({});

        expect(mockApiClient.makeRequest).toHaveBeenCalledWith({
          method: 'GET',
          endpoint: '/entities/co-unknown-id',
        });
        expect(result.content[0].text).toContain('Company: Resolved Corp');
      });

      it('should show domain as fallback when entity API has no name', async () => {
        const noteWithCompanyId = [{
          id: 'note-co3',
          fields: { content: 'Feedback', tags: [] },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: {
            data: [{ type: 'customer', target: { type: 'company', id: 'co-domain-id' } }],
          },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(noteWithCompanyId);
        mockApiClient.makeRequest.mockResolvedValue({ data: { fields: { domain: 'acme.com' } } });

        const result = await tool.execute({});

        expect(result.content[0].text).toContain('Company: acme.com');
      });

      it('should fall back to ID string when entity API call fails', async () => {
        const noteWithCompanyId = [{
          id: 'note-co4',
          fields: { content: 'Feedback', tags: [] },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: {
            data: [{ type: 'customer', target: { type: 'company', id: 'co-fail-id' } }],
          },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(noteWithCompanyId);
        mockApiClient.makeRequest.mockRejectedValue(new Error('Not found'));

        const result = await tool.execute({});

        expect(result.content[0].text).toContain('Company: ID: co-fail-id');
      });

      it('should batch-resolve company IDs without duplicate API calls', async () => {
        const notesWithSameCompany = [
          {
            id: 'note-a',
            fields: { content: 'Feedback A', tags: [] },
            createdAt: '2025-01-01T00:00:00Z',
            relationships: {
              data: [{ type: 'customer', target: { type: 'company', id: 'shared-co-id' } }],
            },
            links: {},
          },
          {
            id: 'note-b',
            fields: { content: 'Feedback B', tags: [] },
            createdAt: '2025-01-01T00:00:00Z',
            relationships: {
              data: [{ type: 'customer', target: { type: 'company', id: 'shared-co-id' } }],
            },
            links: {},
          },
        ];
        mockApiClient.getAllPages.mockResolvedValue(notesWithSameCompany);
        mockApiClient.makeRequest.mockResolvedValue({ data: { fields: { name: 'Shared Corp' } } });

        await tool.execute({});

        // Should only call the entity API once despite two notes with the same company ID
        expect(mockApiClient.makeRequest).toHaveBeenCalledTimes(1);
      });
    });

    describe('links extraction', () => {
      it('should include Productboard URL when present', async () => {
        const noteWithUrl = [{
          id: 'note-url',
          fields: { content: 'Feedback', tags: [] },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: { data: [] },
          links: { html: 'https://myorg.productboard.com/all-notes/notes/12345' },
        }];
        mockApiClient.getAllPages.mockResolvedValue(noteWithUrl);

        const result = await tool.execute({});

        expect(result.content[0].text).toContain('URL: https://myorg.productboard.com/all-notes/notes/12345');
      });

      it('should omit URL line when links.html is absent', async () => {
        const noteWithoutUrl = [{
          id: 'note-no-url',
          fields: { content: 'Feedback', tags: [] },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: { data: [] },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(noteWithoutUrl);

        const result = await tool.execute({});

        expect(result.content[0].text).not.toContain('URL:');
      });

      it('should include linked feature IDs from relationships when resolution fails', async () => {
        const noteWithFeature = [{
          id: 'note-feat',
          fields: { content: 'Feedback', tags: [] },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: {
            data: [
              { type: 'link', target: { type: 'feature', id: 'feat-abc' } },
              { type: 'link', target: { type: 'feature', id: 'feat-def' } },
            ],
          },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(noteWithFeature);
        mockApiClient.makeRequest.mockRejectedValue(new Error('Not found'));

        const result = await tool.execute({});

        // Falls back to raw IDs when resolution fails
        expect(result.content[0].text).toContain('Linked features: feat-abc, feat-def');
      });

      it('should resolve linked feature IDs to names via API', async () => {
        const noteWithFeature = [{
          id: 'note-feat-resolved',
          fields: { content: 'Feedback', tags: [] },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: {
            data: [{ type: 'link', target: { type: 'feature', id: 'feat-xyz' } }],
          },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(noteWithFeature);
        mockApiClient.makeRequest.mockResolvedValue({
          data: {
            fields: { name: 'My Feature Name' },
            links: { html: 'https://example.productboard.com/detail/abc123' },
          },
        });

        const result = await tool.execute({});

        expect(mockApiClient.makeRequest).toHaveBeenCalledWith({
          method: 'GET',
          endpoint: '/entities/feat-xyz',
        });
        expect(result.content[0].text).toContain('Linked features: My Feature Name (https://example.productboard.com/detail/abc123)');
      });

      it('should show feature name without URL when links.html is absent', async () => {
        const noteWithFeature = [{
          id: 'note-feat-no-url',
          fields: { content: 'Feedback', tags: [] },
          createdAt: '2025-01-01T00:00:00Z',
          relationships: {
            data: [{ type: 'link', target: { type: 'feature', id: 'feat-no-url' } }],
          },
          links: {},
        }];
        mockApiClient.getAllPages.mockResolvedValue(noteWithFeature);
        mockApiClient.makeRequest.mockResolvedValue({
          data: { fields: { name: 'Feature Without URL' }, links: {} },
        });

        const result = await tool.execute({});

        expect(result.content[0].text).toContain('Linked features: Feature Without URL');
        expect(result.content[0].text).not.toContain('(http');
      });

      it('should batch-resolve feature IDs without duplicate API calls', async () => {
        const notesWithSameFeature = [
          {
            id: 'note-fa',
            fields: { content: 'Feedback A', tags: [] },
            createdAt: '2025-01-01T00:00:00Z',
            relationships: {
              data: [{ type: 'link', target: { type: 'feature', id: 'shared-feat-id' } }],
            },
            links: {},
          },
          {
            id: 'note-fb',
            fields: { content: 'Feedback B', tags: [] },
            createdAt: '2025-01-01T00:00:00Z',
            relationships: {
              data: [{ type: 'link', target: { type: 'feature', id: 'shared-feat-id' } }],
            },
            links: {},
          },
        ];
        mockApiClient.getAllPages.mockResolvedValue(notesWithSameFeature);
        mockApiClient.makeRequest.mockResolvedValue({
          data: { fields: { name: 'Shared Feature' }, links: { html: 'https://example.com' } },
        });

        await tool.execute({});

        // Should only call the entity API once despite two notes with the same feature ID
        expect(mockApiClient.makeRequest).toHaveBeenCalledTimes(1);
      });

      it('should omit linked features line when no feature links exist', async () => {
        mockApiClient.getAllPages.mockResolvedValue([mockNotes[0]]);

        const result = await tool.execute({});

        expect(result.content[0].text).not.toContain('Linked features:');
      });
    });

    describe('resolve_entities and maxItems', () => {
      const noteWithRelationships = {
        id: 'note-re',
        fields: { content: 'Feedback', tags: [] },
        createdAt: '2025-01-01T00:00:00Z',
        relationships: {
          data: [
            { type: 'customer', target: { type: 'company', id: 'co-skip' } },
            { type: 'link', target: { type: 'feature', id: 'feat-skip' } },
          ],
        },
        links: {},
      };

      it('should pass maxItems equal to limit into getAllPages', async () => {
        mockApiClient.getAllPages.mockResolvedValue([]);

        await tool.execute({ limit: 7 });

        expect(mockApiClient.getAllPages).toHaveBeenCalledWith(
          '/notes',
          expect.anything(),
          { maxItems: 7 },
        );
      });

      it('should pass default maxItems of 20 when limit is omitted', async () => {
        mockApiClient.getAllPages.mockResolvedValue([]);

        await tool.execute({});

        expect(mockApiClient.getAllPages).toHaveBeenCalledWith(
          '/notes',
          expect.anything(),
          { maxItems: 20 },
        );
      });

      it('should skip all entity API calls when resolve_entities is false', async () => {
        mockApiClient.getAllPages.mockResolvedValue([noteWithRelationships]);

        await tool.execute({ resolve_entities: false });

        expect(mockApiClient.makeRequest).not.toHaveBeenCalled();
      });

      it('should perform entity resolution by default when resolve_entities is omitted', async () => {
        mockApiClient.getAllPages.mockResolvedValue([noteWithRelationships]);
        mockApiClient.makeRequest.mockResolvedValue({ data: { fields: { name: 'Corp' } } });

        await tool.execute({});

        expect(mockApiClient.makeRequest).toHaveBeenCalled();
      });

      it('should perform entity resolution when resolve_entities is explicitly true', async () => {
        mockApiClient.getAllPages.mockResolvedValue([noteWithRelationships]);
        mockApiClient.makeRequest.mockResolvedValue({ data: { fields: { name: 'Corp' } } });

        await tool.execute({ resolve_entities: true });

        expect(mockApiClient.makeRequest).toHaveBeenCalled();
      });
    });
  });
});
