use std::{
    path::PathBuf,
    time::{Duration, SystemTime},
};

use axum::{Json, extract::Query};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utils::{assets::config_path, response::ApiResponse};

#[derive(Deserialize, Default)]
pub struct Options {
    refresh: Option<bool>,
}

#[derive(Debug, Serialize)]
struct Plugin {
    name: String,
    description: String,
    version: Option<String>,
    source: Value,
    install_source: Option<String>,
    install_commit: Option<String>,
    marketplace: String,
    tags: Vec<String>,
    components: Vec<String>,
}

#[derive(Serialize)]
pub struct Catalog {
    plugins: Vec<Plugin>,
    warnings: Vec<String>,
}

fn parse(body: &str, repo: &str) -> Result<Vec<Plugin>, serde_json::Error> {
    #[derive(Deserialize)]
    struct Marketplace {
        plugins: Vec<Value>,
    }
    let marketplace: Marketplace = serde_json::from_str(body)?;
    Ok(marketplace
        .plugins
        .into_iter()
        .filter_map(|entry| {
            let name = entry.get("name")?.as_str()?.to_owned();
            let mut tags = Vec::new();
            for key in ["tags", "keywords"] {
                if let Some(values) = entry.get(key).and_then(Value::as_array) {
                    tags.extend(values.iter().filter_map(Value::as_str).map(str::to_owned));
                }
            }
            if let Some(category) = entry.get("category").and_then(Value::as_str) {
                tags.push(category.to_owned());
            }
            let components = ["mcpServers", "skills", "commands", "agents", "hooks"]
                .into_iter()
                .filter(|key| {
                    entry
                        .get(key)
                        .is_some_and(|value| !value.is_null() && value != &Value::Bool(false))
                })
                .map(str::to_owned)
                .collect();
            let source = entry.get("source").cloned().unwrap_or(Value::Null);
            let (install_source, install_commit) = map_source(&source, repo).unwrap_or_default();
            Some(Plugin {
                name,
                description: entry
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                version: entry
                    .get("version")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                source,
                install_source,
                install_commit,
                marketplace: repo.to_owned(),
                tags,
                components,
            })
        })
        .collect())
}

fn map_source(source: &Value, marketplace: &str) -> Option<(Option<String>, Option<String>)> {
    let (url, path, commit) = if let Some(value) = source.as_str() {
        if let Some(path) = value.strip_prefix("./") {
            (format!("https://github.com/{marketplace}.git"), path, None)
        } else {
            (value.to_owned(), "", None)
        }
    } else {
        let kind = source.get("source")?.as_str()?;
        let url = match kind {
            "github" => format!("https://github.com/{}.git", source.get("repo")?.as_str()?),
            "url" | "git" | "git-subdir" => source.get("url")?.as_str()?.to_owned(),
            _ => return None,
        };
        (
            url,
            source.get("path").and_then(Value::as_str).unwrap_or(""),
            source.get("sha").and_then(Value::as_str).map(str::to_owned),
        )
    };
    if !(url.starts_with("https://")
        || url.starts_with("ssh://")
        || url.starts_with("git://")
        || url.starts_with("git@"))
        || url.contains('#')
        || path.split('/').any(|part| part.starts_with('.'))
    {
        return None;
    }
    Some((Some(format!("marketplace+{url}#{path}")), commit))
}

fn valid_repo(repo: &str) -> bool {
    let parts: Vec<_> = repo.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && *part != "."
                && *part != ".."
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
}

pub async fn catalog(Query(options): Query<Options>) -> Json<ApiResponse<Catalog>> {
    let mut repos = vec!["anthropics/claude-plugins-official".to_owned()];
    if let Ok(extra) = std::env::var("HIVEDECK_CLAUDE_MARKETPLACES") {
        repos.extend(
            extra
                .split(',')
                .map(str::trim)
                .filter(|repo| !repo.is_empty())
                .map(str::to_owned),
        );
    }
    repos.sort();
    repos.dedup();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build();
    let mut result = Catalog {
        plugins: Vec::new(),
        warnings: Vec::new(),
    };
    for repo in repos {
        if !valid_repo(&repo) {
            result.warnings.push(format!("Invalid repository: {repo}"));
            continue;
        }
        let cache: PathBuf = config_path()
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("marketplace-cache")
            .join(format!("{repo}.json"));
        let cached = tokio::fs::read_to_string(&cache)
            .await
            .ok()
            .filter(|body| parse(body, &repo).is_ok());
        let fresh = !options.refresh.unwrap_or(false)
            && cached.is_some()
            && std::fs::metadata(&cache)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|time| SystemTime::now().duration_since(time).ok())
                .is_some_and(|age| age < Duration::from_secs(3600));
        let fetched = if fresh {
            None
        } else if let Ok(client) = &client {
            let url = format!(
                "https://raw.githubusercontent.com/{repo}/HEAD/.claude-plugin/marketplace.json"
            );
            match client.get(url).send().await {
                Ok(mut response)
                    if response.status().is_success()
                        && response.content_length().unwrap_or(0) <= 5_000_000 =>
                {
                    let mut bytes = Vec::new();
                    while let Ok(Some(chunk)) = response.chunk().await {
                        bytes.extend_from_slice(&chunk);
                        if bytes.len() > 5_000_000 {
                            break;
                        }
                    }
                    String::from_utf8(bytes)
                        .ok()
                        .filter(|body| body.len() <= 5_000_000 && parse(body, &repo).is_ok())
                }
                _ => None,
            }
        } else {
            None
        };
        if let Some(body) = &fetched {
            if let Some(parent) = cache.parent()
                && tokio::fs::create_dir_all(parent).await.is_ok()
            {
                let temporary = cache.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
                if tokio::fs::write(&temporary, body).await.is_ok() {
                    let _ = tokio::fs::rename(&temporary, &cache).await;
                }
                let _ = tokio::fs::remove_file(temporary).await;
            }
        } else if !fresh {
            result.warnings.push(format!(
                "Could not refresh {repo}; cached data may be stale"
            ));
        }
        if let Some(body) = fetched.or(cached) {
            match parse(&body, &repo) {
                Ok(plugins) => result.plugins.extend(plugins),
                Err(_) => result.warnings.push(format!("Invalid catalog: {repo}")),
            }
        }
    }
    Json(ApiResponse::success(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_marketplace_fixture() {
        let plugins = parse(include_str!("marketplace-fixture.json"), "owner/repo").unwrap();
        assert_eq!(plugins[0].name, "example");
        assert_eq!(plugins[0].components, ["mcpServers", "skills", "hooks"]);
        assert_eq!(plugins[0].tags, ["search", "tools"]);
        assert_eq!(plugins[0].version.as_deref(), Some("1.0"));
        assert!(plugins[1].components.is_empty());
        assert_eq!(plugins[1].source, "./plugins/unknown");
        assert!(plugins[1].version.is_none());
        assert!(parse("{}", "owner/repo").is_err());
        assert_eq!(
            plugins[0].source["url"],
            "https://github.com/example/plugin"
        );
        assert!(!valid_repo("../repo"));
        assert_eq!(
            map_source(&serde_json::json!("./plugins/foo"), "owner/repo")
                .unwrap()
                .0
                .as_deref(),
            Some("marketplace+https://github.com/owner/repo.git#plugins/foo")
        );
        assert_eq!(
            map_source(
                &serde_json::json!({"source":"github","repo":"a/b"}),
                "owner/repo"
            )
            .unwrap()
            .0
            .as_deref(),
            Some("marketplace+https://github.com/a/b.git#")
        );
        assert!(map_source(&serde_json::json!("./../secret"), "owner/repo").is_none());
        assert_eq!(
            map_source(
                &serde_json::json!({"source":"git-subdir", "url":"https://example.com/repo.git", "path":"plugins/example", "sha":"abcdef0"}),
                "owner/repo"
            ),
            Some((
                Some("marketplace+https://example.com/repo.git#plugins/example".into()),
                Some("abcdef0".into())
            ))
        );
    }
}
