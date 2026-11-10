use std::fmt;

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct OwnerId(String);

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct PrincipalId(String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IdError;

fn parse_label(raw: &str) -> Result<String, IdError> {
    let bytes = raw.as_bytes();
    if !(1..=64).contains(&bytes.len()) {
        return Err(IdError);
    }
    if !bytes
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
    {
        return Err(IdError);
    }
    Ok(raw.to_string())
}

impl OwnerId {
    pub fn parse(raw: &str) -> Result<Self, IdError> {
        parse_label(raw).map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl PrincipalId {
    pub fn parse(raw: &str) -> Result<Self, IdError> {
        parse_label(raw).map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for OwnerId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl fmt::Debug for PrincipalId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}
