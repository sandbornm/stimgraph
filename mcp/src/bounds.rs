//! Typed limits for tool arguments. Values that fail here never reach SQL.

pub const MAX_LIMIT: u32 = 50;
pub const DEFAULT_LIMIT: u32 = 20;
pub const MAX_OFFSET: u32 = 5_000;
pub const MAX_QUERY_CHARS: usize = 200;
pub const MAX_TERMS: usize = 8;
pub const MAX_TERM_CHARS: usize = 64;
pub const MAX_AUTHOR_CHARS: usize = 64;
pub const MAX_TOPIC_CHARS: usize = 64;
pub const MAX_TEXT_CHARS: usize = 16_000;
pub const MAX_OWNER_ROWS: i64 = 5_000;
pub const MAX_TOPICS: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchQuery {
    pub terms: Vec<String>,
    pub author: Option<String>,
    pub topic: Option<String>,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PostId(String);

impl PostId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundError {
    QueryTooLong,
    TooManyTerms,
    TermTooLong,
    Limit,
    Cursor,
    Author,
    Topic,
    PostId,
}

impl BoundError {
    pub fn message(self) -> &'static str {
        match self {
            Self::QueryTooLong => "query is too long",
            Self::TooManyTerms => "query has too many terms",
            Self::TermTooLong => "a query term is too long",
            Self::Limit => "limit must be from 1 to 50",
            Self::Cursor => "cursor must be an offset from 0 to 5000",
            Self::Author => "author is too long",
            Self::Topic => "topic is too long",
            Self::PostId => "post_id must be a decimal id",
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct SearchInput {
    pub q: String,
    pub author: String,
    pub topic: String,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
}

pub fn parse_search(input: SearchInput) -> Result<SearchQuery, BoundError> {
    if input.q.chars().count() > MAX_QUERY_CHARS {
        return Err(BoundError::QueryTooLong);
    }
    let terms = input
        .q
        .split_whitespace()
        .map(str::to_lowercase)
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    if terms.len() > MAX_TERMS {
        return Err(BoundError::TooManyTerms);
    }
    if terms
        .iter()
        .any(|term| term.chars().count() > MAX_TERM_CHARS)
    {
        return Err(BoundError::TermTooLong);
    }
    Ok(SearchQuery {
        terms,
        author: optional_label(&input.author, MAX_AUTHOR_CHARS, BoundError::Author)?,
        topic: optional_label(&input.topic, MAX_TOPIC_CHARS, BoundError::Topic)?,
        offset: parse_cursor(input.cursor)?,
        limit: parse_limit(input.limit)?,
    })
}

pub fn parse_list(limit: Option<u32>, cursor: Option<String>) -> Result<SearchQuery, BoundError> {
    parse_search(SearchInput {
        limit,
        cursor,
        ..SearchInput::default()
    })
}

pub fn parse_post_id(raw: &str) -> Result<PostId, BoundError> {
    if raw.is_empty() || raw.len() > 32 || !raw.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(BoundError::PostId);
    }
    Ok(PostId(raw.to_string()))
}

fn optional_label(
    raw: &str,
    max_chars: usize,
    error: BoundError,
) -> Result<Option<String>, BoundError> {
    let trimmed = raw.trim().trim_start_matches('@');
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > max_chars {
        return Err(error);
    }
    Ok(Some(trimmed.to_lowercase()))
}

fn parse_limit(limit: Option<u32>) -> Result<u32, BoundError> {
    match limit {
        None => Ok(DEFAULT_LIMIT),
        Some(value) if (1..=MAX_LIMIT).contains(&value) => Ok(value),
        Some(_) => Err(BoundError::Limit),
    }
}

fn parse_cursor(cursor: Option<String>) -> Result<u32, BoundError> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    if cursor.is_empty() || cursor.len() > 5 || !cursor.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(BoundError::Cursor);
    }
    let offset: u32 = cursor.parse().map_err(|_| BoundError::Cursor)?;
    if offset > MAX_OFFSET {
        return Err(BoundError::Cursor);
    }
    Ok(offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_bounds_reject_before_a_query_would_run() {
        assert_eq!(
            parse_search(SearchInput {
                limit: Some(0),
                ..SearchInput::default()
            }),
            Err(BoundError::Limit)
        );
        assert_eq!(
            parse_search(SearchInput {
                limit: Some(51),
                ..SearchInput::default()
            }),
            Err(BoundError::Limit)
        );
        assert_eq!(
            parse_search(SearchInput {
                cursor: Some("5001".to_string()),
                ..SearchInput::default()
            }),
            Err(BoundError::Cursor)
        );
        assert_eq!(
            parse_search(SearchInput {
                q: "x".repeat(201),
                ..SearchInput::default()
            }),
            Err(BoundError::QueryTooLong)
        );
        assert_eq!(parse_post_id("nope"), Err(BoundError::PostId));
        assert_eq!(parse_post_id("12"), Ok(PostId("12".to_string())));
    }

    #[test]
    fn search_normalizes_terms_author_and_topic() {
        let query = parse_search(SearchInput {
            q: "  Lattice Models ".to_string(),
            author: "@Ada".to_string(),
            topic: "Security".to_string(),
            limit: None,
            cursor: None,
        })
        .unwrap();
        assert_eq!(
            query.terms,
            vec!["lattice".to_string(), "models".to_string()]
        );
        assert_eq!(query.author.as_deref(), Some("ada"));
        assert_eq!(query.topic.as_deref(), Some("security"));
        assert_eq!(query.limit, DEFAULT_LIMIT);
        assert_eq!(query.offset, 0);
    }
}
