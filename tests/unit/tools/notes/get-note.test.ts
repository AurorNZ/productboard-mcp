import { GetNoteTool } from '@tools/notes/get-note';
import { ProductboardAPIClient } from '@api/index';
import { Logger } from '@utils/logger';

describe('GetNoteTool', () => {
  let tool: GetNoteTool;
  let mockApiClient: jest.Mocked<ProductboardAPIClient> & { get: jest.Mock };
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockApiClient = {
      makeRequest: jest.fn(),
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    } as any;

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;

    tool = new GetNoteTool(mockApiClient, mockLogger);
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('should initialize with correct name and description', () => {
      expect(tool.name).toBe('pb_note_get');
      expect(tool.description).toBe('Get a customer feedback note by ID');
    });

    it('should define the correct parameters schema', () => {
      expect(tool.parameters).toMatchObject({
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'string',
            description: 'The Productboard note ID',
          },
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Parameter validation
  // ---------------------------------------------------------------------------
  describe('parameter validation', () => {
    it('should throw when id is missing', async () => {
      await expect(tool.execute({} as any)).rejects.toThrow('Invalid parameters');
    });
  });

  // ---------------------------------------------------------------------------
  // execute – basic behaviour
  // ---------------------------------------------------------------------------
  describe('execute', () => {
    const baseNote = {
      id: 'ac653d0e-8534-4353-b63a-94b115ff64e7',
      fields: {
        name: 'Test Note Title',
        content: 'Some customer feedback.',
        owner: { email: 'owner@example.com' },
        tags: [],
      },
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-16T12:00:00Z',
      relationships: { data: [] },
      links: { html: 'https://myorg.productboard.com/all-notes/notes/12345' },
    };

    it('should fetch a note by ID using GET /notes/{id}', async () => {
      mockApiClient.get.mockResolvedValue({ data: baseNote });

      await tool.execute({ id: baseNote.id });

      expect(mockApiClient.get).toHaveBeenCalledWith(`/notes/${baseNote.id}`);
      expect(mockLogger.info).toHaveBeenCalledWith('Getting note', { noteId: baseNote.id });
    });

    it('should encode special characters in note ID to prevent path traversal', async () => {
      mockApiClient.get.mockResolvedValue({ data: { ...baseNote, id: 'note/malicious' } });

      await tool.execute({ id: 'note/malicious' });

      expect(mockApiClient.get).toHaveBeenCalledWith('/notes/note%2Fmalicious');
    });

    it('should return note fields in a formatted text block', async () => {
      mockApiClient.get.mockResolvedValue({ data: baseNote });

      const result = await tool.execute({ id: baseNote.id });

      const text: string = result.content[0].text;
      expect(text).toContain(`ID: ${baseNote.id}`);
      expect(text).toContain('Title: Test Note Title');
      expect(text).toContain('Created: 2026-01-15T10:00:00Z');
      expect(text).toContain('Updated: 2026-01-16T12:00:00Z');
      expect(text).toContain('Owner: owner@example.com');
      expect(text).toContain('Content: Some customer feedback.');
      expect(text).toContain('Tags: None');
      expect(text).toContain('URL: https://myorg.productboard.com/all-notes/notes/12345');
    });

    it('should handle a note returned directly (no data wrapper)', async () => {
      mockApiClient.get.mockResolvedValue(baseNote);

      const result = await tool.execute({ id: baseNote.id });

      expect(result.content[0].text).toContain(`ID: ${baseNote.id}`);
    });

    it('should return a not-found message when response is falsy', async () => {
      mockApiClient.get.mockResolvedValue(null);

      const result = await tool.execute({ id: 'missing-id' });

      expect(result.content[0].text).toBe('Note missing-id not found.');
    });

    it('should omit Created line when createdAt is absent', async () => {
      const noteNoDate = { ...baseNote, createdAt: undefined };
      mockApiClient.get.mockResolvedValue({ data: noteNoDate });

      const result = await tool.execute({ id: baseNote.id });

      expect(result.content[0].text).not.toContain('Created:');
    });

    it('should omit Updated line when updatedAt is absent', async () => {
      const noteNoUpdated = { ...baseNote, updatedAt: undefined };
      mockApiClient.get.mockResolvedValue({ data: noteNoUpdated });

      const result = await tool.execute({ id: baseNote.id });

      expect(result.content[0].text).not.toContain('Updated:');
    });

    it('should show "(no title)" when name field is empty', async () => {
      const noteNoTitle = { ...baseNote, fields: { ...baseNote.fields, name: '' } };
      mockApiClient.get.mockResolvedValue({ data: noteNoTitle });

      const result = await tool.execute({ id: baseNote.id });

      expect(result.content[0].text).toContain('Title: (no title)');
    });

    it('should show "Unknown" owner when owner email is absent', async () => {
      const noteNoOwner = { ...baseNote, fields: { ...baseNote.fields, owner: {} } };
      mockApiClient.get.mockResolvedValue({ data: noteNoOwner });

      const result = await tool.execute({ id: baseNote.id });

      expect(result.content[0].text).toContain('Owner: Unknown');
    });

    it('should omit URL line when links.html is absent', async () => {
      const noteNoUrl = { ...baseNote, links: {} };
      mockApiClient.get.mockResolvedValue({ data: noteNoUrl });

      const result = await tool.execute({ id: baseNote.id });

      expect(result.content[0].text).not.toContain('URL:');
    });

    it('should return an error response on API failure', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Network failure'));

      const result = await tool.execute({ id: baseNote.id });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Content extraction
  // ---------------------------------------------------------------------------
  describe('content extraction', () => {
    it('should strip HTML tags from plain text content', async () => {
      const note = {
        id: 'note-html',
        fields: {
          content: '<p>Hello <strong>world</strong></p>',
          tags: [],
        },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Content: Hello world');
      expect(result.content[0].text).not.toContain('<p>');
      expect(result.content[0].text).not.toContain('<strong>');
    });

    it('should decode HTML entities in content', async () => {
      const note = {
        id: 'note-entities',
        fields: {
          content: 'Price &lt; $10 &amp; shipping &gt; $5',
          tags: [],
        },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Content: Price < $10 & shipping > $5');
    });

    it('should format conversationNote content with author prefixes', async () => {
      const note = {
        id: 'note-conv',
        fields: {
          content: [
            { authorName: 'Alice', content: 'Hello there' },
            { authorName: 'Bob', content: 'Hi back' },
          ],
          tags: [],
        },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('[PB note from "Alice"]: Hello there');
      expect(result.content[0].text).toContain('[PB note from "Bob"]: Hi back');
    });

    it('should fall back to authorType when authorName is absent', async () => {
      const note = {
        id: 'note-conv-type',
        fields: {
          content: [{ authorType: 'customer', content: 'I need help' }],
          tags: [],
        },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('[PB note from "customer"]: I need help');
    });

    it('should fall back to "Unknown" when both authorName and authorType are absent', async () => {
      const note = {
        id: 'note-conv-unknown',
        fields: {
          content: [{ content: 'Anonymous message' }],
          tags: [],
        },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('[PB note from "Unknown"]: Anonymous message');
    });

    it('should return empty string for missing content field', async () => {
      const note = {
        id: 'note-no-content',
        fields: { tags: [] },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Content: ');
    });
  });

  // ---------------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------------
  describe('tags', () => {
    it('should list tags by name', async () => {
      const note = {
        id: 'note-tags',
        fields: {
          content: 'Feedback',
          tags: [{ name: 'ux' }, { name: 'bug' }],
        },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Tags: ux, bug');
    });

    it('should fall back to tag label when name is absent', async () => {
      const note = {
        id: 'note-tags-label',
        fields: {
          content: 'Feedback',
          tags: [{ label: 'important' }],
        },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Tags: important');
    });

    it('should show "None" when there are no tags', async () => {
      const note = {
        id: 'note-no-tags',
        fields: { content: 'Feedback', tags: [] },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Tags: None');
    });
  });

  // ---------------------------------------------------------------------------
  // Company extraction
  // ---------------------------------------------------------------------------
  describe('company extraction', () => {
    it('should show company name from relationship target when available', async () => {
      const note = {
        id: 'note-co',
        fields: { content: 'Feedback', tags: [] },
        relationships: {
          data: [{ type: 'customer', target: { type: 'company', id: 'co-1', name: 'Acme Corp' } }],
        },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Company: Acme Corp');
    });

    it('should show domain when name is absent but domain is present', async () => {
      const note = {
        id: 'note-co-domain',
        fields: { content: 'Feedback', tags: [] },
        relationships: {
          data: [{ type: 'customer', target: { type: 'company', id: 'co-2', domain: 'acme.com' } }],
        },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Company: acme.com');
    });

    it('should fall back to "ID: <id>" when neither name nor domain is present', async () => {
      const note = {
        id: 'note-co-id',
        fields: { content: 'Feedback', tags: [] },
        relationships: {
          data: [{ type: 'customer', target: { type: 'company', id: 'co-unknown' } }],
        },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Company: ID: co-unknown');
    });

    it('should omit Company line when there is no customer relationship', async () => {
      const note = {
        id: 'note-no-co',
        fields: { content: 'Feedback', tags: [] },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).not.toContain('Company:');
    });
  });

  // ---------------------------------------------------------------------------
  // Feature resolution
  // ---------------------------------------------------------------------------
  describe('feature resolution', () => {
    it('should resolve linked feature IDs to names and URLs', async () => {
      const note = {
        id: 'note-feat',
        fields: { content: 'Feedback', tags: [] },
        relationships: {
          data: [{ type: 'link', target: { type: 'feature', id: 'feat-abc' } }],
        },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });
      mockApiClient.makeRequest.mockResolvedValue({
        data: {
          fields: { name: 'Dark Mode Support' },
          links: { html: 'https://myorg.productboard.com/feature/feat-abc' },
        },
      });

      const result = await tool.execute({ id: note.id });

      expect(mockApiClient.makeRequest).toHaveBeenCalledWith({
        method: 'GET',
        endpoint: '/entities/feat-abc',
      });
      expect(result.content[0].text).toContain(
        'Linked features: Dark Mode Support (https://myorg.productboard.com/feature/feat-abc)'
      );
    });

    it('should show feature name without URL when links.html is absent', async () => {
      const note = {
        id: 'note-feat-no-url',
        fields: { content: 'Feedback', tags: [] },
        relationships: {
          data: [{ type: 'link', target: { type: 'feature', id: 'feat-no-url' } }],
        },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });
      mockApiClient.makeRequest.mockResolvedValue({
        data: { fields: { name: 'Feature Without URL' }, links: {} },
      });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Linked features: Feature Without URL');
      expect(result.content[0].text).not.toContain('(http');
    });

    it('should fall back to raw feature ID when resolution API call fails', async () => {
      const note = {
        id: 'note-feat-fail',
        fields: { content: 'Feedback', tags: [] },
        relationships: {
          data: [{ type: 'link', target: { type: 'feature', id: 'feat-fail-id' } }],
        },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });
      mockApiClient.makeRequest.mockRejectedValue(new Error('Not found'));

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).toContain('Linked features: feat-fail-id');
    });

    it('should fall back to raw ID when entity response has no name', async () => {
      const note = {
        id: 'note-feat-no-name',
        fields: { content: 'Feedback', tags: [] },
        relationships: {
          data: [{ type: 'link', target: { type: 'feature', id: 'feat-no-name' } }],
        },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });
      mockApiClient.makeRequest.mockResolvedValue({ data: { fields: {}, links: {} } });

      const res = await tool.execute({ id: note.id });

      // resolveFeature returns null when name is absent → falls back to raw ID
      expect(res.content[0].text).toContain('Linked features: feat-no-name');
    });

    it('should resolve multiple linked features in parallel', async () => {
      const note = {
        id: 'note-multi-feat',
        fields: { content: 'Feedback', tags: [] },
        relationships: {
          data: [
            { type: 'link', target: { type: 'feature', id: 'feat-1' } },
            { type: 'link', target: { type: 'feature', id: 'feat-2' } },
          ],
        },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });
      mockApiClient.makeRequest
        .mockResolvedValueOnce({ data: { fields: { name: 'Feature One' }, links: {} } })
        .mockResolvedValueOnce({ data: { fields: { name: 'Feature Two' }, links: {} } });

      const result = await tool.execute({ id: note.id });

      expect(mockApiClient.makeRequest).toHaveBeenCalledTimes(2);
      expect(result.content[0].text).toContain('Feature One');
      expect(result.content[0].text).toContain('Feature Two');
    });

    it('should omit Linked features line when no feature links exist', async () => {
      const note = {
        id: 'note-no-feat',
        fields: { content: 'Feedback', tags: [] },
        relationships: { data: [] },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });

      const result = await tool.execute({ id: note.id });

      expect(result.content[0].text).not.toContain('Linked features:');
    });

    it('should only include feature relationships, ignoring other relationship types', async () => {
      const note = {
        id: 'note-mixed-rels',
        fields: { content: 'Feedback', tags: [] },
        relationships: {
          data: [
            { type: 'customer', target: { type: 'company', id: 'co-1', name: 'Acme' } },
            { type: 'link', target: { type: 'feature', id: 'feat-only' } },
            { type: 'other', target: { type: 'something', id: 'other-id' } },
          ],
        },
        links: {},
      };
      mockApiClient.get.mockResolvedValue({ data: note });
      mockApiClient.makeRequest.mockResolvedValue({
        data: { fields: { name: 'Resolved Feature' }, links: {} },
      });

      await tool.execute({ id: note.id });

      // Only the feature link should trigger a makeRequest call
      expect(mockApiClient.makeRequest).toHaveBeenCalledTimes(1);
      expect(mockApiClient.makeRequest).toHaveBeenCalledWith({
        method: 'GET',
        endpoint: '/entities/feat-only',
      });
    });
  });
});
