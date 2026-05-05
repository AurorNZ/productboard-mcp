/**
 * Unit tests for getAllPages maxItems early-exit behaviour.
 * Uses nock to intercept HTTP calls, matching the pattern in client.test.ts.
 */
import { ProductboardAPIClient } from '../../../src/api/client.js';
import { Logger } from '../../../src/utils/logger.js';
import { RateLimiter } from '../../../src/middleware/rateLimiter.js';
import nock from 'nock';

const BASE_URL = 'https://api.productboard.com/v2';

describe('ProductboardAPIClient.getAllPages — maxItems early-exit', () => {
  let client: ProductboardAPIClient;
  let mockAuthManager: any;
  let mockLogger: jest.Mocked<Logger>;
  let mockRateLimiter: jest.Mocked<RateLimiter>;

  beforeEach(() => {
    mockAuthManager = {
      getAuthHeaders: jest.fn().mockReturnValue({ Authorization: 'Bearer test-token' }),
      refreshTokenIfNeeded: jest.fn(),
      isAuthenticated: jest.fn().mockReturnValue(true),
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    mockRateLimiter = {
      waitForSlot: jest.fn().mockResolvedValue(undefined),
      isLimited: jest.fn().mockReturnValue(false),
      getRemainingRequests: jest.fn().mockReturnValue(100),
    } as any;

    client = new ProductboardAPIClient(
      { baseUrl: BASE_URL, timeout: 5000, retryAttempts: 1, retryDelay: 0 },
      mockAuthManager,
      mockLogger,
      mockRateLimiter,
    );
  });

  afterEach(() => nock.cleanAll());

  it('fetches all pages when maxItems is not set', async () => {
    nock(BASE_URL)
      .get('/notes')
      .reply(200, {
        data: [{ id: '1' }, { id: '2' }],
        links: { next: `${BASE_URL}/notes?pageCursor=cursor-p2` },
      });
    nock(BASE_URL)
      .get('/notes')
      .query({ pageCursor: 'cursor-p2' })
      .reply(200, { data: [{ id: '3' }], links: {} });

    const result = await client.getAllPages('/notes');

    expect(result).toHaveLength(3);
    expect((result[0] as any).id).toBe('1');
    expect((result[2] as any).id).toBe('3');
  });

  it('stops after the first page when maxItems equals the first page size', async () => {
    nock(BASE_URL)
      .get('/notes')
      .reply(200, {
        data: [{ id: '1' }, { id: '2' }],
        links: { next: `${BASE_URL}/notes?pageCursor=cursor-p2` },
      });
    // Second page should never be requested
    nock(BASE_URL)
      .get('/notes')
      .query({ pageCursor: 'cursor-p2' })
      .reply(200, { data: [{ id: '3' }], links: {} });

    const result = await client.getAllPages('/notes', {}, { maxItems: 2 });

    // Stopped after page 1 — page 2 nock never consumed
    expect(result).toHaveLength(2);
    expect(nock.pendingMocks()).toHaveLength(1); // page 2 was never called
  });

  it('stops after the first page when maxItems is smaller than the page size', async () => {
    nock(BASE_URL)
      .get('/notes')
      .reply(200, {
        data: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }],
        links: { next: `${BASE_URL}/notes?pageCursor=cursor-p2` },
      });
    nock(BASE_URL)
      .get('/notes')
      .query({ pageCursor: 'cursor-p2' })
      .reply(200, { data: [{ id: '6' }], links: {} });

    const result = await client.getAllPages('/notes', {}, { maxItems: 3 });

    // Fetched page 1 (5 items >= maxItems 3) — page 2 never requested
    expect(result).toHaveLength(5);
    expect(nock.pendingMocks()).toHaveLength(1);
  });

  it('fetches a second page when the first page has fewer items than maxItems', async () => {
    nock(BASE_URL)
      .get('/notes')
      .reply(200, {
        data: [{ id: '1' }, { id: '2' }],
        links: { next: `${BASE_URL}/notes?pageCursor=cursor-p2` },
      });
    nock(BASE_URL)
      .get('/notes')
      .query({ pageCursor: 'cursor-p2' })
      .reply(200, {
        data: [{ id: '3' }, { id: '4' }],
        links: { next: `${BASE_URL}/notes?pageCursor=cursor-p3` },
      });
    // Third page — should not be fetched
    nock(BASE_URL)
      .get('/notes')
      .query({ pageCursor: 'cursor-p3' })
      .reply(200, { data: [{ id: '5' }], links: {} });

    const result = await client.getAllPages('/notes', {}, { maxItems: 4 });

    // 2 + 2 = 4 >= maxItems — stops after page 2
    expect(result).toHaveLength(4);
    expect(nock.pendingMocks()).toHaveLength(1); // page 3 not called
  });

  it('passes query params on all paginated requests', async () => {
    nock(BASE_URL)
      .get('/notes')
      .query({ processed: 'true' })
      .reply(200, {
        data: [{ id: '1' }],
        links: { next: `${BASE_URL}/notes?processed=true&pageCursor=cursor-p2` },
      });
    nock(BASE_URL)
      .get('/notes')
      .query({ processed: 'true', pageCursor: 'cursor-p2' })
      .reply(200, { data: [{ id: '2' }], links: {} });

    const result = await client.getAllPages('/notes', { processed: true });

    expect(result).toHaveLength(2);
  });
});
