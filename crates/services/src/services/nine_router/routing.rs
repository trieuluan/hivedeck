//! Route agent runs through the embedded 9router by role (ADR-028).
//!
//! Each run gets a role (orchestrator → planner, review → reviewer,
//! everything else → coder). When routing is on, Claude Code is pointed at
//! 9router through its process environment and, unless the user picked a
//! model, runs on the role's combo (`--model <combo>`; Claude warns about an
//! unrecognized model name but passes it through). Claude's own model aliases
//! map onto combos too, so background/sub-agent calls stay on the right tier:
//! opus/fable → planner, sonnet → coder, haiku → fast.
//!
//! Environment, not `--settings`: Claude Code ignores auth variables given
//! through `--settings` and falls back to its OAuth login (verified with
//! Claude Code 2.1.306), while process env takes effect.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{ComboRole, NineRouterSettings, base_url};

/// Combo name per role. `None` leaves that role on the agent's own default.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct RoleCombos {
    #[serde(default)]
    pub planner: Option<String>,
    #[serde(default)]
    pub coder: Option<String>,
    #[serde(default)]
    pub reviewer: Option<String>,
    #[serde(default)]
    pub fast: Option<String>,
}

impl RoleCombos {
    pub fn get(&self, role: ComboRole) -> Option<&str> {
        match role {
            ComboRole::Planner => self.planner.as_deref(),
            ComboRole::Coder => self.coder.as_deref(),
            ComboRole::Reviewer => self.reviewer.as_deref(),
            ComboRole::Fast => self.fast.as_deref(),
        }
        .map(str::trim)
        .filter(|s| !s.is_empty())
    }
}

/// What the host should do for one Claude Code run.
#[derive(Clone, Debug, PartialEq)]
pub struct ClaudeRoute {
    pub role: ComboRole,
    /// Model to run on (the role's combo), when the user did not pick one.
    pub model: Option<String>,
    /// Environment variables for the Claude Code process.
    pub env: Vec<(String, String)>,
}

/// Routing decision for a Claude Code run, or `None` when routing is off.
/// `explicit_model` is a model the user chose for this run/profile; it is
/// never replaced.
pub fn claude_route(
    settings: &NineRouterSettings,
    role: ComboRole,
    explicit_model: bool,
) -> Option<ClaudeRoute> {
    if !settings.route_agents {
        return None;
    }
    let roles = &settings.roles;
    let mut env = vec![
        ("ANTHROPIC_BASE_URL".to_string(), base_url(settings.port)),
        // 9router accepts loopback requests without a key; a placeholder keeps
        // Claude Code from sending the user's own Anthropic credentials to it.
        (
            "ANTHROPIC_AUTH_TOKEN".to_string(),
            "hivedeck-local".to_string(),
        ),
    ];
    for (var, alias_role) in [
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", ComboRole::Planner),
        ("ANTHROPIC_DEFAULT_FABLE_MODEL", ComboRole::Planner),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", ComboRole::Coder),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", ComboRole::Fast),
        ("ANTHROPIC_SMALL_FAST_MODEL", ComboRole::Fast),
    ] {
        if let Some(combo) = roles.get(alias_role) {
            env.push((var.to_string(), combo.to_string()));
        }
    }
    Some(ClaudeRoute {
        role,
        model: (!explicit_model)
            .then(|| roles.get(role).map(str::to_string))
            .flatten(),
        env,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(route: bool) -> NineRouterSettings {
        NineRouterSettings {
            route_agents: route,
            roles: RoleCombos {
                planner: Some("planner".into()),
                coder: Some("coder".into()),
                reviewer: Some(" ".into()),
                fast: Some("fast".into()),
            },
            ..Default::default()
        }
    }

    #[test]
    fn off_means_no_route() {
        assert!(claude_route(&settings(false), ComboRole::Coder, false).is_none());
    }

    #[test]
    fn picks_role_combo_unless_user_chose_a_model() {
        let r = claude_route(&settings(true), ComboRole::Planner, false).unwrap();
        assert_eq!(r.model.as_deref(), Some("planner"));
        let env = |k: &str| r.env.iter().find(|(v, _)| v == k).map(|(_, x)| x.as_str());
        assert_eq!(env("ANTHROPIC_BASE_URL"), Some("http://127.0.0.1:20128/v1"));
        assert_eq!(env("ANTHROPIC_DEFAULT_SONNET_MODEL"), Some("coder"));
        assert_eq!(env("ANTHROPIC_DEFAULT_FABLE_MODEL"), Some("planner"));
        assert_eq!(env("ANTHROPIC_DEFAULT_HAIKU_MODEL"), Some("fast"));

        let kept = claude_route(&settings(true), ComboRole::Coder, true).unwrap();
        assert_eq!(kept.model, None);
    }

    #[test]
    fn blank_role_leaves_default_model() {
        let r = claude_route(&settings(true), ComboRole::Reviewer, false).unwrap();
        assert_eq!(r.model, None);
        // Still routed through 9router.
        assert!(r.env.iter().any(|(k, _)| k == "ANTHROPIC_BASE_URL"));
    }
}
