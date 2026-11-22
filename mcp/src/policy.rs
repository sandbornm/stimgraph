//! A denial carries no bookmark rows. An allow carries exactly one owner id,
//! and that id is the only compartment the store is allowed to read.

use crate::ids::{OwnerId, PrincipalId};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Search,
    List,
    Detail,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Principal {
    pub id: PrincipalId,
    pub owner_id: OwnerId,
    pub revoked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow { owner: OwnerId },
    Deny,
}

pub fn authorize(principal: Option<&Principal>, tool: Tool) -> Decision {
    let Some(principal) = principal else {
        return Decision::Deny;
    };
    if principal.revoked {
        return Decision::Deny;
    }
    match tool {
        Tool::Search | Tool::List | Tool::Detail => Decision::Allow {
            owner: principal.owner_id.clone(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn principal(revoked: bool) -> Principal {
        Principal {
            id: PrincipalId::parse("agent-a").unwrap(),
            owner_id: OwnerId::parse("owner-a").unwrap(),
            revoked,
        }
    }

    #[test]
    fn active_principal_may_read_only_its_owner() {
        let principal = principal(false);
        for tool in [Tool::Search, Tool::List, Tool::Detail] {
            match authorize(Some(&principal), tool) {
                Decision::Allow { owner } => assert_eq!(owner.as_str(), "owner-a"),
                Decision::Deny => panic!("active principal was denied {tool:?}"),
            }
        }
    }

    #[test]
    fn missing_and_revoked_principals_disclose_nothing() {
        let revoked = principal(true);
        assert_eq!(authorize(None, Tool::Search), Decision::Deny);
        assert_eq!(authorize(Some(&revoked), Tool::Detail), Decision::Deny);
    }
}
