import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  name: text('name').notNull(),
  profileImageUrl: text('profile_image_url'),
  connectedAt: integer('connected_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const bookmarks = sqliteTable(
  'bookmarks',
  {
    ownerId: text('owner_id').notNull(),
    postId: text('post_id').notNull(),
    authorId: text('author_id').notNull(),
    authorUsername: text('author_username').notNull(),
    authorName: text('author_name').notNull(),
    authorProfileImageUrl: text('author_profile_image_url'),
    text: text('text').notNull(),
    createdAt: text('created_at'),
    language: text('language'),
    entitiesJson: text('entities_json').notNull().default('{}'),
    metricsJson: text('metrics_json').notNull().default('{}'),
    syncedAt: integer('synced_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.postId] }),
    index('idx_bookmarks_owner_author').on(table.ownerId, table.authorId),
    index('idx_bookmarks_owner_created').on(table.ownerId, table.createdAt),
  ],
);

export const topics = sqliteTable(
  'topics',
  {
    ownerId: text('owner_id').notNull(),
    id: text('id').notNull(),
    label: text('label').notNull(),
    source: text('source').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    index('idx_topics_owner_label').on(table.ownerId, table.label),
  ],
);

export const bookmarkTopics = sqliteTable(
  'bookmark_topics',
  {
    ownerId: text('owner_id').notNull(),
    postId: text('post_id').notNull(),
    topicId: text('topic_id').notNull(),
    confidence: integer('confidence').notNull().default(100),
    evidence: text('evidence').notNull(),
    source: text('source').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.postId, table.topicId] }),
    index('idx_bookmark_topics_owner_topic').on(table.ownerId, table.topicId),
  ],
);

export const follows = sqliteTable(
  'follows',
  {
    ownerId: text('owner_id').notNull(),
    userId: text('user_id').notNull(),
    username: text('username').notNull(),
    name: text('name').notNull(),
    profileImageUrl: text('profile_image_url'),
    description: text('description'),
    syncedAt: integer('synced_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.userId] }),
    index('idx_follows_owner_username').on(table.ownerId, table.username),
  ],
);

export const scouts = sqliteTable(
  'scouts',
  {
    ownerId: text('owner_id').notNull(),
    postId: text('post_id').notNull(),
    authorUsername: text('author_username').notNull(),
    authorName: text('author_name').notNull(),
    text: text('text').notNull(),
    url: text('url'),
    topicId: text('topic_id'),
    topicLabel: text('topic_label').notNull(),
    reason: text('reason').notNull(),
    confidence: integer('confidence').notNull().default(70),
    scoutedAt: integer('scouted_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.postId] }),
    index('idx_scouts_owner_scouted').on(table.ownerId, table.scoutedAt),
  ],
);
