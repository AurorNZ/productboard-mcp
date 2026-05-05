export const ENDPOINTS = {
  features: {
    list: '/features',
    get: '/features/:id',
    create: '/features',
    update: '/features/:id',
    delete: '/features/:id',
    archive: '/features/:id/archive',
    unarchive: '/features/:id/unarchive',
    attachNote: '/features/:id/notes',
    linkObjective: '/features/:id/objectives',
  },
  products: {
    list: '/products',
    get: '/products/:id',
    create: '/products',
    update: '/products/:id',
    delete: '/products/:id',
    hierarchy: '/products/:id/hierarchy',
    components: '/products/:id/components',
  },
  notes: {
    list: '/notes',
    search: '/notes/search',
    get: '/notes/:id',
    create: '/notes',
    update: '/notes/:id',
    delete: '/notes/:id',
    attachToFeature: '/notes/:id/features',
    detachFromFeature: '/notes/:id/features/:featureId',
  },
  users: {
    list: '/users',
    get: '/users/:id',
    current: '/users/current',
    invite: '/users/invite',
    deactivate: '/users/:id/deactivate',
    reactivate: '/users/:id/reactivate',
  },
  objectives: {
    list: '/objectives',
    get: '/objectives/:id',
    create: '/objectives',
    update: '/objectives/:id',
    delete: '/objectives/:id',
    linkFeature: '/objectives/:id/features',
    unlinkFeature: '/objectives/:id/features/:featureId',
    keyResults: '/objectives/:id/key-results',
  },
  tags: {
    list: '/tags',
    get: '/tags/:id',
    create: '/tags',
    update: '/tags/:id',
    delete: '/tags/:id',
  },
  webhooks: {
    list: '/webhooks',
    get: '/webhooks/:id',
    create: '/webhooks',
    update: '/webhooks/:id',
    delete: '/webhooks/:id',
    test: '/webhooks/:id/test',
  },
} as const;

export type EndpointPaths = typeof ENDPOINTS;

export function buildEndpoint(template: string, params?: Record<string, string>): string {
  let endpoint = template;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      endpoint = endpoint.replace(`:${key}`, encodeURIComponent(value));
    });
  }
  return endpoint;
}

export function extractPathParams(template: string): string[] {
  const matches = template.match(/:(\w+)/g);
  return matches ? matches.map((match) => match.substring(1)) : [];
}