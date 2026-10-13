import type { StoredBookmark } from '@/db/storage';
import { XRequestError, retryTime } from './x-errors';

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
  startToken,
  pageSize = 100,
}: {
  accessToken: string;
  userId: string;
  limit: number;
  startToken?: string;
  pageSize?: number;
}): AsyncGenerator<BookmarkPage> {
  let paginationToken: string | undefined = startToken;
  let fetched = 0;
  let page = 0;

  while (fetched < limit) {
    const url = new URL(`https://api.x.com/2/users/${userId}/bookmarks`);
    url.searchParams.set('max_results', String(Math.max(1, Math.min(100, pageSize, limit - fetched))));
    url.searchParams.set('tweet.fields', 'id,text,author_id,created_at,lang,entities,public_metrics');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'id,name,username,profile_image_url');
    if (paginationToken) url.searchParams.set('pagination_token', paginationToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new XRequestError(response.status, retryTime(response));
    }

    const payload = (await response.json()) as XBookmarksResponse;
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
}: {
  accessToken: string;
  userId: string;
  limit: number;
}): Promise<{ bookmarks: StoredBookmark[]; hasMore: boolean }> {
  const bookmarks: StoredBookmark[] = [];
  let hasMore = false;
  for await (const page of iterateXBookmarks({ accessToken, userId, limit })) {
    bookmarks.push(...page.bookmarks);
    hasMore = page.hasMore;
  }
  return { bookmarks, hasMore };
}
