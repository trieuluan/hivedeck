//! Per-session rotation of combos (ADR-036).
//!
//! 9router's own round-robin counts requests per combo, so a running agent
//! session hops provider on every call and never hits a prompt cache. Here
//! HiveDeck rotates per *session* instead: for a combo `coder = [a, b, c]`
//! it keeps `coder-r1 = [a, b, c]`, `coder-r2 = [b, c, a]`, `coder-r3 =
//! [c, a, b]` in 9router (all walked as `fallback`), and each agent session
//! is pinned to one of them by its id. A session stays on one provider (warm
//! cache), new sessions start on different providers (quota spread across
//! all of them), and a provider that runs out still falls through.

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use uuid::Uuid;

use super::{NineRouterError, NineRouterSettings, api, log_line, management_client};

/// Roles whose sessions rotate. Workers and reviewers run many short
/// sessions, so spreading them spreads quota. The captain is one long
/// session (rotating it would only risk moving it off its first model), and
/// `fast` calls go through Claude's model aliases, not a session model.
pub const ROTATED_ROLES: [super::ComboRole; 2] =
    [super::ComboRole::Coder, super::ComboRole::Reviewer];

/// Suffix of a rotation combo: `coder-r2`.
const SUFFIX: &str = "-r";

/// Combo name → number of rotations kept in 9router (0 = none, use as is).
fn known() -> &'static Mutex<HashMap<String, usize>> {
    static KNOWN: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();
    KNOWN.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn rotation_name(combo: &str, index: usize) -> String {
    format!("{combo}{SUFFIX}{}", index + 1)
}

/// `true` for `coder-r3` style names (hidden from combo lists).
pub fn is_rotation_name(name: &str) -> bool {
    name.rsplit_once(SUFFIX)
        .is_some_and(|(base, n)| !base.is_empty() && n.parse::<usize>().is_ok_and(|n| n > 0))
}

/// The models of rotation `index`: the list started at `index`.
pub fn rotate(models: &[String], index: usize) -> Vec<String> {
    let n = models.len();
    (0..n).map(|i| models[(index + i) % n].clone()).collect()
}

/// Which rotation a session uses. Stable for the session's lifetime, so its
/// follow-ups stay on the same provider.
pub fn pick(session_id: Uuid, rotations: usize) -> usize {
    (session_id.as_u128() % rotations.max(1) as u128) as usize
}

/// Bring the rotations of `combos` in line with their current models.
/// Returns combo → rotation count.
pub async fn sync(
    settings: &NineRouterSettings,
    combos: &[String],
) -> Result<HashMap<String, usize>, NineRouterError> {
    let client = management_client(settings)?;
    let existing = client.combos().await?;
    let by_name: HashMap<&str, &api::Combo> =
        existing.iter().map(|c| (c.name.as_str(), c)).collect();
    let mut counts = HashMap::new();
    for combo in combos {
        let Some(base) = by_name.get(combo.as_str()) else {
            continue;
        };
        let models = &base.models;
        // One model: nothing to rotate.
        let n = if models.len() > 1 { models.len() } else { 0 };
        for index in 0..n {
            let name = rotation_name(combo, index);
            let wanted = rotate(models, index);
            match by_name.get(name.as_str()) {
                Some(c) if c.models == wanted => {}
                Some(c) => client.update_combo(&c.id, &wanted).await?,
                None => client.create_combo(&name, &wanted).await?,
            }
        }
        // Drop rotations left over from a longer model list.
        for c in &existing {
            if let Some(index) = c
                .name
                .strip_prefix(&format!("{combo}{SUFFIX}"))
                .and_then(|n| n.parse::<usize>().ok())
                && index > n
            {
                client.delete_combo(&c.id).await?;
            }
        }
        counts.insert(combo.clone(), n);
    }
    log_line(&format!("combo rotations synced: {counts:?}")).await;
    known().lock().unwrap().extend(counts.clone());
    Ok(counts)
}

/// Delete every rotation combo HiveDeck created.
pub async fn remove_all(settings: &NineRouterSettings) -> Result<(), NineRouterError> {
    let client = management_client(settings)?;
    for c in client.combos().await? {
        if is_rotation_name(&c.name) {
            client.delete_combo(&c.id).await?;
        }
    }
    invalidate();
    log_line("combo rotations removed").await;
    Ok(())
}

/// Forget cached counts (a combo changed); the next run re-syncs.
pub fn invalidate() {
    known().lock().unwrap().clear();
}

/// The model a session should run on instead of `combo`: its rotation, or
/// `combo` itself when there is nothing to rotate or 9router can't be asked.
pub async fn model_for_session(
    settings: &NineRouterSettings,
    combo: &str,
    session_id: Uuid,
) -> String {
    let cached = known().lock().unwrap().get(combo).copied();
    let count = match cached {
        Some(n) => n,
        None => match sync(settings, &[combo.to_string()]).await {
            Ok(counts) => counts.get(combo).copied().unwrap_or(0),
            Err(e) => {
                tracing::warn!("combo rotation unavailable for {combo}: {e}");
                0
            }
        },
    };
    if count == 0 {
        combo.to_string()
    } else {
        rotation_name(combo, pick(session_id, count))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn models(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn rotations_start_at_each_model_and_keep_the_rest_as_fallback() {
        let m = models(&["a", "b", "c"]);
        assert_eq!(rotate(&m, 0), models(&["a", "b", "c"]));
        assert_eq!(rotate(&m, 1), models(&["b", "c", "a"]));
        assert_eq!(rotate(&m, 2), models(&["c", "a", "b"]));
    }

    #[test]
    fn a_session_always_gets_the_same_rotation() {
        let id = Uuid::new_v4();
        assert_eq!(pick(id, 4), pick(id, 4));
        assert!(pick(id, 4) < 4);
    }

    #[test]
    fn sessions_spread_over_all_rotations() {
        let mut seen = [0usize; 3];
        for _ in 0..300 {
            seen[pick(Uuid::new_v4(), 3)] += 1;
        }
        assert!(seen.iter().all(|&n| n > 50), "{seen:?}");
    }

    #[test]
    fn rotation_names() {
        assert_eq!(rotation_name("coder", 0), "coder-r1");
        assert!(is_rotation_name("coder-r2"));
        assert!(!is_rotation_name("coder"));
        assert!(!is_rotation_name("my-router"));
        assert!(!is_rotation_name("-r1"));
    }
}
