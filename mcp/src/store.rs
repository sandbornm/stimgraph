//! Parameterized reads of one owner's bookmark rows.
//!
//! The connection is read-only, `query_only`, and an authorizer allowlist.
//! Bookmark text stays a field on the view. It is not a command.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{
    hooks::{AuthAction, AuthContext, Authorization},
    Connection, OpenFlags,
};

use crate::bounds::{PostId, SearchQuery, MAX_OWNER_ROWS, MAX_TEXT_CHARS, MAX_TOPICS};
use crate::ids::OwnerId;

const COUNT_BY_OWNER: &str = "SELECT COUNT(*) FROM bookmarks WHERE owner_id = ?1";

const BOOKMARKS_BY_OWNER: &str = "SELECT post_id, author_username, author_name, text, created_at \
     FROM bookmarks WHERE owner_id = ?1 \
     ORDER BY created_at DESC, synced_at DESC, post_id ASC";

const TOPICS_BY_OWNER: &str = "SELECT bt.post_id, t.id, t.label \
     FROM bookmark_topics AS bt \
     INNER JOIN topics AS t ON t.owner_id = bt.owner_id AND t.id = bt.topic_id \
     WHERE bt.owner_id = ?1 \
     ORDER BY t.label ASC, t.id ASC";

const BOOKMARK_BY_ID: &str = "SELECT post_id, author_username, author_name, text, created_at \
     FROM bookmarks WHERE owner_id = ?1 AND post_id = ?2";

const TOPICS_BY_POST: &str = "SELECT t.id, t.label \
     FROM bookmark_topics AS bt \
     INNER JOIN topics AS t ON t.owner_id = bt.owner_id AND t.id = bt.topic_id \
     WHERE bt.owner_id = ?1 AND bt.post_id = ?2 \
     ORDER BY t.label ASC, t.id ASC";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TopicView {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BookmarkView {
    pub id: String,
    pub author: String,
    pub handle: String,
    pub text: String,
    pub created_at: Option<String>,
    pub url: Option<String>,
    pub topics: Vec<TopicView>,
    pub text_truncated: bool,
    pub topics_truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BookmarkPage {
    pub matched: u32,
    pub bookmarks: Vec<BookmarkView>,
    pub next_cursor: Option<String>,
}

#[derive(Debug)]
pub enum StoreError {
    Open,
    NotReadOnly,
    Window,
    Read,
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::Open => "database did not open",
            Self::NotReadOnly => "database connection is not read-only",
            Self::Window => "owner row window exceeded",
            Self::Read => "bookmark read failed",
        };
        formatter.write_str(message)
    }
}

pub struct ReadOnlyStore {
    conn: Connection,
}

impl ReadOnlyStore {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if path.exists() && !path.is_file() {
            return Err(StoreError::Open);
        }
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| StoreError::Open)?;
        conn.pragma_update(None, "query_only", "ON")
            .map_err(|_| StoreError::NotReadOnly)?;
        let query_only: i64 = conn
            .query_row("PRAGMA query_only", [], |row| row.get(0))
            .map_err(|_| StoreError::NotReadOnly)?;
        if query_only != 1 {
            return Err(StoreError::NotReadOnly);
        }
        let mut store = Self { conn };
        store
            .conn
            .authorizer(Some(allow_bookmark_reads))
            .map_err(|_| StoreError::NotReadOnly)?;
        Ok(store)
    }

    pub fn search(&self, owner: &OwnerId, query: &SearchQuery) -> Result<BookmarkPage, StoreError> {
        self.with_read(|conn| {
            let count = count_owner(conn, owner)?;
            if count > MAX_OWNER_ROWS {
                return Err(StoreError::Window);
            }
            let topics = topics_for_owner(conn, owner)?;
            let mut stmt = conn.prepare(BOOKMARKS_BY_OWNER).map_err(read_error)?;
            let rows = stmt
                .query_map([owner.as_str()], |row| read_bookmark(row, &topics))
                .map_err(read_error)?;
            let mut matched = Vec::new();
            for row in rows {
                let view = row.map_err(read_error)?;
                if row_matches(&view, query) {
                    matched.push(view);
                }
            }
            drop(stmt);
            Ok(page(matched, query))
        })
    }

    pub fn get(
        &self,
        owner: &OwnerId,
        post_id: &PostId,
    ) -> Result<Option<BookmarkView>, StoreError> {
        self.with_read(|conn| {
            let topics = topics_for_post(conn, owner, post_id)?;
            let mut stmt = conn.prepare(BOOKMARK_BY_ID).map_err(read_error)?;
            let mut rows = stmt
                .query([owner.as_str(), post_id.as_str()])
                .map_err(read_error)?;
            let Some(row) = rows.next().map_err(read_error)? else {
                return Ok(None);
            };
            Ok(Some(read_bookmark(row, &topics).map_err(read_error)?))
        })
    }

    fn with_read<T>(
        &self,
        body: impl FnOnce(&Connection) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        self.conn.execute_batch("BEGIN").map_err(read_error)?;
        let mut close = CloseRead {
            conn: &self.conn,
            closed: false,
        };
        let result = body(&self.conn);
        let end = if result.is_ok() { "COMMIT" } else { "ROLLBACK" };
        self.conn.execute_batch(end).map_err(read_error)?;
        close.closed = true;
        result
    }
}

struct CloseRead<'a> {
    conn: &'a Connection,
    closed: bool,
}

impl Drop for CloseRead<'_> {
    fn drop(&mut self) {
        if !self.closed {
            let _ = self.conn.execute_batch("ROLLBACK");
        }
    }
}

fn allow_bookmark_reads(ctx: AuthContext<'_>) -> Authorization {
    match ctx.action {
        AuthAction::Select | AuthAction::Recursive | AuthAction::Function { .. } => {
            Authorization::Allow
        }
        AuthAction::Transaction { .. } => Authorization::Allow,
        AuthAction::Read { table_name, .. } if is_bookmark_table(table_name) => {
            Authorization::Allow
        }
        AuthAction::Pragma {
            pragma_name,
            pragma_value,
        } if pragma_name.eq_ignore_ascii_case("query_only")
            && query_only_stays_on(pragma_value) =>
        {
            Authorization::Allow
        }
        _ => Authorization::Deny,
    }
}

fn is_bookmark_table(table_name: &str) -> bool {
    matches!(table_name, "bookmarks" | "topics" | "bookmark_topics")
}

fn query_only_stays_on(value: Option<&str>) -> bool {
    matches!(
        value,
        None | Some("1") | Some("ON") | Some("on") | Some("true") | Some("TRUE")
    )
}

fn count_owner(conn: &Connection, owner: &OwnerId) -> Result<i64, StoreError> {
    conn.query_row(COUNT_BY_OWNER, [owner.as_str()], |row| row.get(0))
        .map_err(read_error)
}

fn topics_for_owner(
    conn: &Connection,
    owner: &OwnerId,
) -> Result<HashMap<String, Vec<TopicView>>, StoreError> {
    let mut stmt = conn.prepare(TOPICS_BY_OWNER).map_err(read_error)?;
    let rows = stmt
        .query_map([owner.as_str()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                TopicView {
                    id: row.get(1)?,
                    label: row.get(2)?,
                },
            ))
        })
        .map_err(read_error)?;
    let mut topics: HashMap<String, Vec<TopicView>> = HashMap::new();
    for row in rows {
        let (post_id, topic) = row.map_err(read_error)?;
        topics.entry(post_id).or_default().push(topic);
    }
    Ok(topics)
}

fn topics_for_post(
    conn: &Connection,
    owner: &OwnerId,
    post_id: &PostId,
) -> Result<HashMap<String, Vec<TopicView>>, StoreError> {
    let mut stmt = conn.prepare(TOPICS_BY_POST).map_err(read_error)?;
    let rows = stmt
        .query_map([owner.as_str(), post_id.as_str()], |row| {
            Ok(TopicView {
                id: row.get(0)?,
                label: row.get(1)?,
            })
        })
        .map_err(read_error)?;
    let mut topics = Vec::new();
    for row in rows {
        topics.push(row.map_err(read_error)?);
    }
    Ok(HashMap::from([(post_id.as_str().to_string(), topics)]))
}

fn read_bookmark(
    row: &rusqlite::Row<'_>,
    topics: &HashMap<String, Vec<TopicView>>,
) -> rusqlite::Result<BookmarkView> {
    let id: String = row.get(0)?;
    let handle: String = row.get(1)?;
    let author: String = row.get(2)?;
    let text: String = row.get(3)?;
    let created_at: Option<String> = row.get(4)?;
    let mut topic_list = topics.get(&id).cloned().unwrap_or_default();
    let topics_truncated = topic_list.len() > MAX_TOPICS;
    topic_list.truncate(MAX_TOPICS);
    let (text, text_truncated) = truncate_text(text);
    Ok(BookmarkView {
        url: bookmark_url(&handle, &id),
        id,
        author,
        handle,
        text,
        created_at,
        topics: topic_list,
        text_truncated,
        topics_truncated,
    })
}

fn truncate_text(text: String) -> (String, bool) {
    if text.chars().count() <= MAX_TEXT_CHARS {
        return (text, false);
    }
    let truncated = text.chars().take(MAX_TEXT_CHARS).collect();
    (truncated, true)
}

fn bookmark_url(handle: &str, post_id: &str) -> Option<String> {
    let handle_ok = (1..=32).contains(&handle.len())
        && handle
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
    let id_ok = !post_id.is_empty()
        && post_id.len() <= 32
        && post_id.bytes().all(|byte| byte.is_ascii_digit());
    if handle_ok && id_ok {
        Some(format!("https://x.com/{handle}/status/{post_id}"))
    } else {
        None
    }
}

fn row_matches(view: &BookmarkView, query: &SearchQuery) -> bool {
    if let Some(author) = &query.author {
        if view.handle.to_lowercase() != *author {
            return false;
        }
    }
    if let Some(topic) = &query.topic {
        let topic_ok = view
            .topics
            .iter()
            .any(|item| item.id.to_lowercase() == *topic || item.label.to_lowercase() == *topic);
        if !topic_ok {
            return false;
        }
    }
    if query.terms.is_empty() {
        return true;
    }
    let haystack = format!(
        "{} {} @{} {}",
        view.text,
        view.author,
        view.handle,
        view.topics
            .iter()
            .map(|topic| topic.label.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    )
    .to_lowercase();
    query.terms.iter().all(|term| haystack.contains(term))
}

fn page(matched: Vec<BookmarkView>, query: &SearchQuery) -> BookmarkPage {
    let total = u32::try_from(matched.len()).unwrap_or(u32::MAX);
    let start = usize::try_from(query.offset).unwrap_or(usize::MAX);
    let end = start.saturating_add(usize::try_from(query.limit).unwrap_or(0));
    let bookmarks = if start >= matched.len() {
        Vec::new()
    } else {
        matched[start..end.min(matched.len())].to_vec()
    };
    let next = start.saturating_add(bookmarks.len());
    let next_cursor = if next < matched.len() {
        Some(next.to_string())
    } else {
        None
    };
    BookmarkPage {
        matched: total,
        bookmarks,
        next_cursor,
    }
}

fn read_error(_error: rusqlite::Error) -> StoreError {
    StoreError::Read
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bounds::parse_post_id;
    use rusqlite::Connection;

    fn denied(error: &rusqlite::Error) -> bool {
        let text = error.to_string().to_lowercase();
        text.contains("not authorized") || text.contains("prohibited")
    }

    fn seed(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE bookmarks (
                owner_id TEXT NOT NULL,
                post_id TEXT NOT NULL,
                author_id TEXT NOT NULL,
                author_username TEXT NOT NULL,
                author_name TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT,
                synced_at INTEGER NOT NULL,
                PRIMARY KEY (owner_id, post_id)
            );
            CREATE TABLE topics (
                owner_id TEXT NOT NULL,
                id TEXT NOT NULL,
                label TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (owner_id, id)
            );
            CREATE TABLE bookmark_topics (
                owner_id TEXT NOT NULL,
                post_id TEXT NOT NULL,
                topic_id TEXT NOT NULL,
                confidence INTEGER NOT NULL,
                evidence TEXT NOT NULL,
                source TEXT NOT NULL,
                PRIMARY KEY (owner_id, post_id, topic_id)
            );
            CREATE TABLE x_sessions (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO bookmarks (owner_id, post_id, author_id, author_username, author_name, text, created_at, synced_at)
             VALUES ('owner-a', '101', '1', 'ada', 'Ada', 'lattice notes', '2026-01-02T00:00:00Z', 2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO bookmarks (owner_id, post_id, author_id, author_username, author_name, text, created_at, synced_at)
             VALUES ('owner-b', '201', '2', 'bea', 'Bea', 'OTHER_OWNER_BOOKMARK_TEXT', '2026-01-03T00:00:00Z', 3)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO topics (owner_id, id, label, source, created_at) VALUES ('owner-a', 'sec', 'Security', 'stored', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO bookmark_topics (owner_id, post_id, topic_id, confidence, evidence, source)
             VALUES ('owner-a', '101', 'sec', 100, 'stored', 'stored')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO x_sessions (id, owner_id, payload, expires_at, created_at, updated_at)
             VALUES ('s', 'owner-a', 'SESSION_PAYLOAD_CANARY', 1, 1, 1)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn search_and_detail_stay_inside_the_owner() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bookmarks.sqlite");
        seed(&path);
        let store = ReadOnlyStore::open(&path).unwrap();
        let owner = OwnerId::parse("owner-a").unwrap();
        let page = store
            .search(
                &owner,
                &SearchQuery {
                    terms: vec!["lattice".to_string()],
                    author: None,
                    topic: Some("security".to_string()),
                    offset: 0,
                    limit: 20,
                },
            )
            .unwrap();
        assert_eq!(page.matched, 1);
        assert_eq!(page.bookmarks[0].id, "101");
        let rendered = format!("{page:?}");
        assert!(!rendered.contains("OTHER_OWNER_BOOKMARK_TEXT"));
        assert!(!rendered.contains("SESSION_PAYLOAD_CANARY"));

        let other = store.get(&owner, &parse_post_id("201").unwrap()).unwrap();
        let missing = store.get(&owner, &parse_post_id("999").unwrap()).unwrap();
        assert_eq!(other, None);
        assert_eq!(missing, None);
    }

    #[test]
    fn injection_text_does_not_cross_owners() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bookmarks.sqlite");
        seed(&path);
        let store = ReadOnlyStore::open(&path).unwrap();
        let page = store
            .search(
                &OwnerId::parse("owner-a").unwrap(),
                &SearchQuery {
                    terms: vec!["' or owner_id != '".to_string()],
                    author: Some("bea".to_string()),
                    topic: None,
                    offset: 0,
                    limit: 20,
                },
            )
            .unwrap();
        assert_eq!(page.matched, 0);
        assert!(page.bookmarks.is_empty());
    }

    #[test]
    fn connection_rejects_writes_and_secret_tables() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bookmarks.sqlite");
        seed(&path);
        let store = ReadOnlyStore::open(&path).unwrap();
        let insert = store.conn.execute(
            "INSERT INTO bookmarks (owner_id, post_id, author_id, author_username, author_name, text, synced_at)
             VALUES ('owner-a', '303', '1', 'ada', 'Ada', 'nope', 1)",
            [],
        );
        assert!(denied(&insert.unwrap_err()));
        let secret = store.conn.query_row(
            "SELECT payload FROM x_sessions WHERE owner_id = 'owner-a'",
            [],
            |row| row.get::<_, String>(0),
        );
        assert!(denied(&secret.unwrap_err()));
        let disable = store.conn.execute_batch("PRAGMA query_only = OFF");
        assert!(disable.is_err());
        let flag: i64 = store
            .conn
            .query_row("PRAGMA query_only", [], |row| row.get(0))
            .unwrap();
        assert_eq!(flag, 1);
    }

    #[test]
    fn missing_file_is_not_created() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.sqlite");
        assert!(ReadOnlyStore::open(&path).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn over_window_returns_no_bookmark_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wide.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE bookmarks (
                owner_id TEXT NOT NULL,
                post_id TEXT NOT NULL,
                author_id TEXT NOT NULL,
                author_username TEXT NOT NULL,
                author_name TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT,
                synced_at INTEGER NOT NULL,
                PRIMARY KEY (owner_id, post_id)
            );
            CREATE TABLE topics (
                owner_id TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL,
                source TEXT NOT NULL, created_at INTEGER NOT NULL,
                PRIMARY KEY (owner_id, id)
            );
            CREATE TABLE bookmark_topics (
                owner_id TEXT NOT NULL, post_id TEXT NOT NULL, topic_id TEXT NOT NULL,
                confidence INTEGER NOT NULL, evidence TEXT NOT NULL, source TEXT NOT NULL,
                PRIMARY KEY (owner_id, post_id, topic_id)
            );",
        )
        .unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        for index in 0..=MAX_OWNER_ROWS {
            tx.execute(
                "INSERT INTO bookmarks (owner_id, post_id, author_id, author_username, author_name, text, synced_at)
                 VALUES ('owner-a', ?1, '1', 'ada', 'Ada', 'WINDOW_ROW_TEXT', ?2)",
                (index.to_string(), index),
            )
            .unwrap();
        }
        tx.commit().unwrap();
        drop(conn);
        let store = ReadOnlyStore::open(&path).unwrap();
        let error = store
            .search(
                &OwnerId::parse("owner-a").unwrap(),
                &SearchQuery {
                    terms: Vec::new(),
                    author: None,
                    topic: None,
                    offset: 0,
                    limit: 20,
                },
            )
            .unwrap_err();
        assert!(matches!(error, StoreError::Window));
        assert!(!error.to_string().contains("WINDOW_ROW_TEXT"));
    }
}
