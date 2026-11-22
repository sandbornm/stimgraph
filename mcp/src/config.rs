//! Process configuration. Tokens are hashed at the boundary and then wiped.

use std::net::SocketAddr;
use std::path::PathBuf;

use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use zeroize::Zeroize;

use crate::ids::{IdError, OwnerId, PrincipalId};
use crate::policy::Principal;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConfigError {
    BindNotLoopback,
    BindInvalid,
    DatabaseNotAbsolute,
    DatabaseMissing,
    PrincipalsInvalid,
    PrincipalId,
    OwnerId,
    Token,
    DuplicatePrincipal,
    DuplicateToken,
    NoPrincipals,
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::BindNotLoopback => "bind address must be a loopback address",
            Self::BindInvalid => "bind address is invalid",
            Self::DatabaseNotAbsolute => "database path must be absolute",
            Self::DatabaseMissing => "database file is missing",
            Self::PrincipalsInvalid => "principals JSON is invalid",
            Self::PrincipalId => "a principal id is invalid",
            Self::OwnerId => "an owner id is invalid",
            Self::Token => "a token must be 16 to 256 graphic ASCII characters",
            Self::DuplicatePrincipal => "a principal id is duplicated",
            Self::DuplicateToken => "a token is duplicated",
            Self::NoPrincipals => "at least one principal is required",
        };
        formatter.write_str(message)
    }
}

pub struct StoredPrincipal {
    pub principal: Principal,
    digest: [u8; 32],
}

impl std::fmt::Debug for StoredPrincipal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StoredPrincipal")
            .field("id", &self.principal.id)
            .field("owner_id", &self.principal.owner_id)
            .field("revoked", &self.principal.revoked)
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
pub struct ServerConfig {
    pub bind: SocketAddr,
    pub database: PathBuf,
    pub principals: Vec<StoredPrincipal>,
}

impl ServerConfig {
    pub fn try_new(
        bind: SocketAddr,
        database: PathBuf,
        principals_json: &str,
    ) -> Result<Self, ConfigError> {
        if !bind.ip().is_loopback() {
            return Err(ConfigError::BindNotLoopback);
        }
        if !database.is_absolute() {
            return Err(ConfigError::DatabaseNotAbsolute);
        }
        let metadata = std::fs::metadata(&database).map_err(|_| ConfigError::DatabaseMissing)?;
        if !metadata.is_file() {
            return Err(ConfigError::DatabaseMissing);
        }
        Ok(Self {
            bind,
            database,
            principals: parse_principals(principals_json)?,
        })
    }

    pub fn from_env() -> Result<Self, ConfigError> {
        let bind = match std::env::var("STIMGRAPH_MCP_BIND") {
            Ok(value) => parse_bind(&value)?,
            Err(_) => parse_bind("127.0.0.1:8765")?,
        };
        let database = std::env::var("STIMGRAPH_MCP_DATABASE")
            .map(PathBuf::from)
            .map_err(|_| ConfigError::DatabaseMissing)?;
        let mut principals =
            std::env::var("STIMGRAPH_MCP_PRINCIPALS").map_err(|_| ConfigError::NoPrincipals)?;
        let config = Self::try_new(bind, database, &principals);
        principals.zeroize();
        // SAFETY: remove_var races any other thread that reads the process
        // environment. The binary calls from_env before it starts a runtime.
        unsafe {
            std::env::remove_var("STIMGRAPH_MCP_PRINCIPALS");
        }
        config
    }
}

pub fn parse_bind(raw: &str) -> Result<SocketAddr, ConfigError> {
    let bind: SocketAddr = raw.parse().map_err(|_| ConfigError::BindInvalid)?;
    if !bind.ip().is_loopback() {
        return Err(ConfigError::BindNotLoopback);
    }
    Ok(bind)
}

#[derive(serde::Deserialize)]
struct RawPrincipal {
    id: String,
    token: String,
    owner_id: String,
    revoked: bool,
}

impl Drop for RawPrincipal {
    fn drop(&mut self) {
        self.token.zeroize();
    }
}

pub fn parse_principals(json: &str) -> Result<Vec<StoredPrincipal>, ConfigError> {
    let mut raws: Vec<RawPrincipal> =
        serde_json::from_str(json).map_err(|_| ConfigError::PrincipalsInvalid)?;
    if raws.is_empty() {
        return Err(ConfigError::NoPrincipals);
    }
    let mut principals = Vec::with_capacity(raws.len());
    for raw in &mut raws {
        let id = PrincipalId::parse(&raw.id).map_err(|IdError| ConfigError::PrincipalId)?;
        let owner_id = OwnerId::parse(&raw.owner_id).map_err(|IdError| ConfigError::OwnerId)?;
        if !token_ok(&raw.token) {
            raw.token.zeroize();
            return Err(ConfigError::Token);
        }
        let digest = digest(raw.token.as_bytes());
        raw.token.zeroize();
        if principals
            .iter()
            .any(|existing: &StoredPrincipal| existing.principal.id == id)
        {
            return Err(ConfigError::DuplicatePrincipal);
        }
        if principals
            .iter()
            .any(|existing: &StoredPrincipal| ct_eq(&existing.digest, &digest))
        {
            return Err(ConfigError::DuplicateToken);
        }
        principals.push(StoredPrincipal {
            principal: Principal {
                id,
                owner_id,
                revoked: raw.revoked,
            },
            digest,
        });
    }
    Ok(principals)
}

pub fn authenticate<'a>(principals: &'a [StoredPrincipal], token: &str) -> Option<&'a Principal> {
    let digest = digest(token.as_bytes());
    let mut found = None;
    for principal in principals {
        if ct_eq(&principal.digest, &digest) {
            found = Some(principal);
        }
    }
    found
        .filter(|principal| !principal.principal.revoked)
        .map(|principal| &principal.principal)
}

fn token_ok(token: &str) -> bool {
    (16..=256).contains(&token.len()) && token.bytes().all(|byte| byte.is_ascii_graphic())
}

fn digest(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn ct_eq(left: &[u8; 32], right: &[u8; 32]) -> bool {
    bool::from(left.ct_eq(right))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn principals() -> String {
        r#"[{"id":"agent-a","token":"inert-token-owner-a","owner_id":"owner-a","revoked":false},{"id":"agent-b","token":"inert-token-owner-b","owner_id":"owner-b","revoked":false},{"id":"former","token":"inert-token-revoked","owner_id":"owner-a","revoked":true}]"#.to_string()
    }

    #[test]
    fn bind_must_be_loopback() {
        assert!(parse_bind("127.0.0.1:0").is_ok());
        assert_eq!(
            parse_bind("0.0.0.0:8765"),
            Err(ConfigError::BindNotLoopback)
        );
        assert_eq!(parse_bind("not-an-address"), Err(ConfigError::BindInvalid));
    }

    #[test]
    fn unknown_and_revoked_tokens_do_not_authenticate() {
        let parsed = parse_principals(&principals()).unwrap();
        let active = authenticate(&parsed, "inert-token-owner-a").unwrap();
        assert_eq!(active.owner_id.as_str(), "owner-a");
        assert!(authenticate(&parsed, "inert-token-revoked").is_none());
        assert!(authenticate(&parsed, "inert-token-missing").is_none());
    }

    #[test]
    fn duplicate_token_and_short_token_are_rejected() {
        let duplicated = r#"[{"id":"agent-a","token":"inert-token-owner-a","owner_id":"owner-a","revoked":false},{"id":"agent-c","token":"inert-token-owner-a","owner_id":"owner-b","revoked":false}]"#;
        assert_eq!(
            parse_principals(duplicated).err(),
            Some(ConfigError::DuplicateToken)
        );
        let short =
            r#"[{"id":"agent-a","token":"short-token","owner_id":"owner-a","revoked":false}]"#;
        assert_eq!(parse_principals(short).err(), Some(ConfigError::Token));
        assert_eq!(
            parse_principals("[]").err(),
            Some(ConfigError::NoPrincipals)
        );
        assert_eq!(
            parse_principals("not-json").err(),
            Some(ConfigError::PrincipalsInvalid)
        );
    }

    #[test]
    fn from_env_clears_the_principal_variable_when_json_is_invalid() {
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("empty.sqlite");
        std::fs::write(&database, b"").unwrap();
        std::env::set_var("STIMGRAPH_MCP_BIND", "127.0.0.1:9");
        std::env::set_var("STIMGRAPH_MCP_DATABASE", &database);
        std::env::set_var("STIMGRAPH_MCP_PRINCIPALS", "not-json");
        let error = ServerConfig::from_env().unwrap_err();
        assert_eq!(error, ConfigError::PrincipalsInvalid);
        assert!(std::env::var("STIMGRAPH_MCP_PRINCIPALS").is_err());
        std::env::remove_var("STIMGRAPH_MCP_BIND");
        std::env::remove_var("STIMGRAPH_MCP_DATABASE");
    }

    #[test]
    fn debug_format_omits_the_token_digest() {
        let parsed = parse_principals(&principals()).unwrap();
        let rendered = format!("{:?}", parsed[0]);
        assert!(!rendered.contains("inert-token"));
        assert!(!rendered.contains("digest"));
    }
}
