import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readImportCursor, storeBookmarks, storeFollows, writeImportCursor } from '@/db/storage';
import { importOwnerBookmarks } from '@/lib/manual-import';
import { finishNonStreamSync } from '@/lib/non-stream-sync';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';
import { fetchXBookmarks } from '@/lib/x-bookmarks';
import { fetchXFollowing, XFollowsScopeError } from '@/lib/x-following';
import { labelAfterSync } from '@/lib/jev-sync';

export const dynamic = 'force-dynamic';

type SyncEvent = {
  type: 'page' | 'following' | 'done' | 'error';
  imported?: number;
  inserted?: number;
  insertedIds?: string[];
  page?: number;
  hasMore?: boolean;
  nextToken?: string | null;
  live?: boolean;
  limit?: number;
  authors?: string[];
  following?: number;
  followingError?: string;
  error?: string;
};

async function importFollowing(accessToken: string, userId: string) {
  try {
    const result = await fetchXFollowing({ accessToken, userId, limit: 1000 });
    await storeFollows({ ownerId: userId, follows: result.follows });
    return { following: result.follows.length };
  } catch (error) {
    const followingError = error instanceof XFollowsScopeError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Following sync failed.';
    return { following: 0, followingError };
  }
}

function cursorStore(ownerId: string) {
  return {
    read: () => readImportCursor(ownerId),
    write: (cursor: string | null) => writeImportCursor(ownerId, cursor),
  };
}

export async function POST(request: NextRequest) {
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ error: 'Connect X before syncing.' }, { status: 401 });

  let requestedLimit = 600;
  let live = false;
  let stream = false;
  try {
    const body = (await request.json()) as { limit?: number; live?: boolean; stream?: boolean };
    if (typeof body.limit === 'number') requestedLimit = body.limit;
    live = body.live === true;
    stream = body.stream === true;
  } catch {
    // The default limit is intentionally conservative.
  }
  const limit = Math.max(1, Math.min(live ? 40 : 1000, Math.floor(requestedLimit)));

  if (live) {
    try {
      const result = await fetchXBookmarks({
        accessToken: active.session.accessToken,
        userId: active.session.profile.id,
        limit,
      });
      const stored = await storeBookmarks({
        owner: active.session.profile,
        bookmarks: result.bookmarks,
        skipUnchanged: true,
      });
      const response = NextResponse.json({
        imported: stored.stored,
        inserted: stored.inserted,
        insertedIds: stored.insertedIds,
        hasMore: false,
        live,
        limit,
      });
      return withRenewedSession(response, request, active.renewedCookie);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bookmark sync failed.';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (!stream) {
    let imported = 0;
    let inserted = 0;
    const insertedIds: string[] = [];
    try {
      const settled = await finishNonStreamSync(
        () => importOwnerBookmarks({
          accessToken: active.session.accessToken,
          userId: active.session.profile.id,
          limit,
          store: cursorStore(active.session.profile.id),
          onPage: async (page) => {
            const stored = await storeBookmarks({
              owner: active.session.profile,
              bookmarks: page.items,
              optimize: !page.nextToken,
            });
            imported += stored.stored;
            inserted += stored.inserted;
            insertedIds.push(...stored.insertedIds);
          },
        }),
        () => labelAfterSync(active.session.profile.id),
      );
      if (!settled.result) {
        return NextResponse.json({ error: settled.error ?? 'Bookmark sync failed.' }, { status: 502 });
      }
      const body = {
        imported, inserted, insertedIds, live, limit,
        hasMore: Boolean(settled.result.cursor), nextToken: settled.result.cursor,
        ...(settled.error ? { error: settled.error } : {}),
      };
      const response = NextResponse.json(body, { status: settled.status });
      return withRenewedSession(response, request, active.renewedCookie);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bookmark sync failed.';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const encoder = new TextEncoder();
  let imported = 0;
  let inserted = 0;
  const allInsertedIds: string[] = [];
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: SyncEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const result = await importOwnerBookmarks({
          accessToken: active.session.accessToken,
          userId: active.session.profile.id,
          limit,
          store: cursorStore(active.session.profile.id),
          onPage: async (page) => {
            const stored = await storeBookmarks({
              owner: active.session.profile,
              bookmarks: page.items,
              optimize: !page.nextToken,
            });
            imported += stored.stored;
            inserted += stored.inserted;
            allInsertedIds.push(...stored.insertedIds);
            send({
              type: 'page',
              imported,
              inserted,
              insertedIds: stored.insertedIds,
              page: page.page,
              hasMore: Boolean(page.nextToken),
              nextToken: page.nextToken,
              limit,
              authors: [...new Set(page.items.map((bookmark) => bookmark.authorUsername))].slice(0, 4),
            });
          },
        });
        if (result.error) {
          send({ type: 'error', error: result.error, imported, inserted, insertedIds: allInsertedIds, limit, hasMore: Boolean(result.cursor), nextToken: result.cursor });
          controller.close();
          return;
        }
        const follows = await importFollowing(active.session.accessToken, active.session.profile.id);
        send({
          type: 'following',
          following: follows.following,
          followingError: follows.followingError,
          imported,
          inserted,
          insertedIds: allInsertedIds,
          limit,
        });
        send({
          type: 'done',
          imported,
          inserted,
          insertedIds: allInsertedIds,
          hasMore: Boolean(result.cursor),
          nextToken: result.cursor,
          limit,
          following: follows.following,
          followingError: follows.followingError,
        });
        controller.close();
        void labelAfterSync(active.session.profile.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Bookmark sync failed.';
        send({ type: 'error', error: message, imported, inserted, insertedIds: allInsertedIds, limit });
        controller.close();
      }
    },
  });

  const response = new NextResponse(readable, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
  return withRenewedSession(response, request, active.renewedCookie);
}
