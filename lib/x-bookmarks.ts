import type { StoredBookmark } from '@/db/storage';

type XPost = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  entities?: {
    hashtags?: Array<{ tag: string }>;
    mentions?: Array<{ username: string; id?: string }>;
    urls?: Array<{ expanded_url?: string; unwound_url?: string; display_url?: string }>;
  };
  public_metrics?: Record<string, number>;
};

type XUser = {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
};

type XBookmarksResponse = {
  data?: XPost[];
  includes?: { users?: XUser[] };
  meta?: { next_token?: string; result_count?: number };
  errors?: unknown[];
};

export type BookmarkPage = {
  bookmarks: StoredBookmark[];
  page: number;
  fetched: number;
  hasMore: boolean;
  nextToken?: string;
};

function mapPosts(payload: XBookmarksResponse): StoredBookmark[] {
  const users = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));
  return (payload.data ?? []).map((post) => {
    const author = users.get(post.author_id ?? '');
    return {
      postId: post.id,
      authorId: author?.id ?? post.author_id ?? 'unknown',
      authorUsername: author?.username ?? 'unknown',
      authorName: author?.name ?? 'Unknown author',
      authorProfileImageUrl: author?.profile_image_url,
      text: post.text,
      createdAt: post.created_at,
      language: post.lang,
      entities: post.entities ?? {},
      metrics: post.public_metrics ?? {},
      hashtags: [...new Set((post.entities?.hashtags ?? []).map((item) => item.tag.trim()).filter(Boolean))],
    };
  });
}

export async function* iterateXBookmarks({
  accessToken,
  userId,
  limit,
  paginationToken,
  signal,
}: {
  accessToken: string;
  userId: string;
  limit: number;
  paginationToken?: string;
  signal?: AbortSignal;
}): AsyncGenerator<BookmarkPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Choose between 1 and 1000 bookmarks per import.');
  let fetched = 0;
  let page = 0;
  const seenTokens = new Set<string>();

  while (fetched < limit) {
    if (paginationToken) {
      if (seenTokens.has(paginationToken)) throw new Error('X repeated a bookmark page. Start a fresh sync to retry.');
      seenTokens.add(paginationToken);
    }
    const url = new URL(`https://api.x.com/2/users/${userId}/bookmarks`);
    // X can return 99 posts and omit next_token for max_results=100 even
    // when older bookmarks exist. Smaller pages preserved pagination in
    // the direct API comparison; keep the overall import limit separate.
    url.searchParams.set('max_results', String(Math.min(20, limit - fetched)));
    url.searchParams.set('tweet.fields', 'id,text,author_id,created_at,lang,entities,public_metrics');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'id,name,username,profile_image_url');
    if (paginationToken) url.searchParams.set('pagination_token', paginationToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('X has temporarily limited bookmark reads. Your imported pages are saved; try continuing later.');
      if (response.status === 401 || response.status === 403) throw new Error('X could not authorize this import. Reconnect X, then try again.');
      throw new Error(`X bookmark sync failed with status ${response.status}`);
    }

    const payload = (await response.json()) as XBookmarksResponse;
    if (payload.errors?.length) throw new Error('X returned an incomplete bookmark page. Your earlier pages are saved; try again later.');
    const bookmarks = mapPosts(payload);
    fetched += bookmarks.length;
    page += 1;
    paginationToken = payload.meta?.next_token;
    yield {
      bookmarks,
      page,
      fetched,
      hasMore: Boolean(paginationToken),
      nextToken: paginationToken,
    };
    if (!paginationToken || bookmarks.length === 0) break;
  }
}

export async function fetchXBookmarks({
  accessToken,
  userId,
  limit,
  paginationToken,
  signal,
}: {
  accessToken: string;
  userId: string;
  limit: number;
  paginationToken?: string;
  signal?: AbortSignal;
}): Promise<{ bookmarks: StoredBookmark[]; hasMore: boolean; nextToken?: string }> {
  const bookmarks: StoredBookmark[] = [];
  let hasMore = false;
  let nextToken: string | undefined;
  for await (const page of iterateXBookmarks({ accessToken, userId, limit, paginationToken, signal })) {
    bookmarks.push(...page.bookmarks);
    hasMore = page.hasMore;
    nextToken = page.nextToken;
  }
  return { bookmarks, hasMore, nextToken };
}
