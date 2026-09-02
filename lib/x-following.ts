export type StoredFollow = {
  userId: string;
  username: string;
  name: string;
  profileImageUrl?: string;
  description?: string;
};

type XUser = {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
  description?: string;
};

type XFollowingResponse = {
  data?: XUser[];
  meta?: { next_token?: string; result_count?: number };
  title?: string;
  detail?: string;
};

export class XFollowsScopeError extends Error {
  constructor() {
    super('Reconnect X to import who you follow. Stimgraph needs the follows.read permission.');
    this.name = 'XFollowsScopeError';
  }
}

export async function fetchXFollowing({
  accessToken,
  userId,
  limit = 1000,
}: {
  accessToken: string;
  userId: string;
  limit?: number;
}): Promise<{ follows: StoredFollow[]; hasMore: boolean }> {
  const follows: StoredFollow[] = [];
  let paginationToken: string | undefined;
  const cap = Math.max(1, Math.min(2000, Math.floor(limit)));

  while (follows.length < cap) {
    const url = new URL(`https://api.x.com/2/users/${userId}/following`);
    url.searchParams.set('max_results', String(Math.min(1000, cap - follows.length)));
    url.searchParams.set('user.fields', 'id,name,username,profile_image_url,description');
    if (paginationToken) url.searchParams.set('pagination_token', paginationToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) {
      throw new XFollowsScopeError();
    }
    if (!response.ok) {
      throw new Error(`X following sync failed with status ${response.status}`);
    }

    const payload = (await response.json()) as XFollowingResponse;
    const page = (payload.data ?? []).map((user) => ({
      userId: user.id,
      username: user.username,
      name: user.name,
      profileImageUrl: user.profile_image_url,
      description: user.description?.replace(/\s+/g, ' ').trim().slice(0, 180) || undefined,
    }));
    follows.push(...page);
    paginationToken = payload.meta?.next_token;
    if (!paginationToken || page.length === 0) {
      return { follows, hasMore: false };
    }
  }

  return { follows, hasMore: Boolean(paginationToken) };
}
