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
};

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
  let paginationToken: string | undefined;
  let hasMore = false;

  while (bookmarks.length < limit) {
    const url = new URL(`https://api.x.com/2/users/${userId}/bookmarks`);
    url.searchParams.set('max_results', String(Math.min(100, limit - bookmarks.length)));
    url.searchParams.set('tweet.fields', 'id,text,author_id,created_at,lang,entities,public_metrics');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'id,name,username,profile_image_url');
    if (paginationToken) url.searchParams.set('pagination_token', paginationToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`X bookmark sync failed with status ${response.status}`);
    }

    const payload = (await response.json()) as XBookmarksResponse;
    const users = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));
    for (const post of payload.data ?? []) {
      const author = users.get(post.author_id ?? '');
      bookmarks.push({
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
      });
    }

    paginationToken = payload.meta?.next_token;
    if (!paginationToken) break;
    hasMore = true;
  }

  return { bookmarks, hasMore };
}
