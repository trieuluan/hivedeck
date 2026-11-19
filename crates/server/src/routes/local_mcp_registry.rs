use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use axum::{
    Extension, Json, Router,
    extract::Path as RoutePath,
    http::StatusCode,
    routing::{get, put},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RegistryTransport {
    Stdio,
    Http,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RegistryCli {
    ClaudeCode,
    Codex,
    Opencode,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RegistryRole {
    Captain,
    Crew,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RegistryEntry {
    pub name: String,
    pub transport: RegistryTransport,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub clis: Vec<RegistryCli>,
    pub roles: Vec<RegistryRole>,
    #[serde(default)]
    pub boards: Vec<String>,
    #[serde(default)]
    pub oauth: bool,
}

#[derive(Deserialize, TS)]
pub struct SetRegistrySecret {
    pub value: String,
}

#[derive(Serialize, TS)]
pub struct RegistrySecretStatus {
    pub name: String,
    pub has_value: bool,
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn validate(entry: &RegistryEntry) -> Result<(), ApiError> {
    if !valid_name(&entry.name)
        || entry
            .headers
            .values()
            .chain(entry.env.values())
            .any(|name| !valid_name(name))
    {
        return Err(ApiError::BadRequest(
            "Invalid name or secret reference".into(),
        ));
    }
    let valid = match entry.transport {
        RegistryTransport::Stdio => {
            entry
                .command
                .as_ref()
                .is_some_and(|command| !command.trim().is_empty())
                && entry.url.is_none()
                && entry.headers.is_empty()
        }
        RegistryTransport::Http => {
            entry.command.is_none()
                && entry.args.is_empty()
                && entry.env.is_empty()
                && entry
                    .url
                    .as_ref()
                    .and_then(|url| url::Url::parse(url).ok())
                    .is_some_and(|url| {
                        matches!(url.scheme(), "http" | "https")
                            && url.host().is_some()
                            && url.username().is_empty()
                            && url.password().is_none()
                    })
        }
    };
    if !valid {
        return Err(ApiError::BadRequest("Invalid transport fields".into()));
    }
    Ok(())
}

fn read<T: DeserializeOwned + Default>(path: &Path) -> Result<T, ApiError> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid registry file").into()
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.into()),
    }
}

fn write<T: Serialize>(path: &Path, value: &T, secret: bool) -> Result<(), ApiError> {
    use std::io::Write;
    let bytes = serde_json::to_vec_pretty(value).map_err(std::io::Error::other)?;
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if secret {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        #[cfg(unix)]
        if secret {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        #[cfg(not(unix))]
        let _ = secret;
        file.write_all(&bytes)?;
        file.sync_all()?;
        std::fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result.map_err(Into::into)
}

async fn list(
    Extension(dir): Extension<PathBuf>,
) -> Result<Json<ApiResponse<Vec<RegistryEntry>>>, ApiError> {
    Ok(Json(ApiResponse::success(read(
        &dir.join("mcp_registry.json"),
    )?)))
}

async fn create(
    Extension(dir): Extension<PathBuf>,
    entry: Result<Json<RegistryEntry>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<RegistryEntry>>, ApiError> {
    let Json(entry) = entry.map_err(|_| ApiError::BadRequest("Invalid registry entry".into()))?;
    validate(&entry)?;
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Registry lock poisoned"))?;
    let path = dir.join("mcp_registry.json");
    let mut entries: Vec<RegistryEntry> = read(&path)?;
    if entries.iter().any(|existing| existing.name == entry.name) {
        return Err(ApiError::Conflict("Registry name already exists".into()));
    }
    entries.push(entry.clone());
    write(&path, &entries, false)?;
    Ok(Json(ApiResponse::success(entry)))
}

async fn update(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
    entry: Result<Json<RegistryEntry>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<RegistryEntry>>, ApiError> {
    let Json(entry) = entry.map_err(|_| ApiError::BadRequest("Invalid registry entry".into()))?;
    validate(&entry)?;
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Registry lock poisoned"))?;
    let path = dir.join("mcp_registry.json");
    let mut entries: Vec<RegistryEntry> = read(&path)?;
    let index = entries
        .iter()
        .position(|existing| existing.name == name)
        .ok_or_else(|| ApiError::BadRequest("Registry entry not found".into()))?;
    if entries
        .iter()
        .enumerate()
        .any(|(other, existing)| other != index && existing.name == entry.name)
    {
        return Err(ApiError::Conflict("Registry name already exists".into()));
    }
    entries[index] = entry.clone();
    write(&path, &entries, false)?;
    Ok(Json(ApiResponse::success(entry)))
}

async fn delete(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
) -> Result<StatusCode, ApiError> {
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Registry lock poisoned"))?;
    let path = dir.join("mcp_registry.json");
    let mut entries: Vec<RegistryEntry> = read(&path)?;
    let length = entries.len();
    entries.retain(|entry| entry.name != name);
    if entries.len() == length {
        return Err(ApiError::BadRequest("Registry entry not found".into()));
    }
    write(&path, &entries, false)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn secret(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
    value: Option<Json<SetRegistrySecret>>,
) -> Result<Json<ApiResponse<RegistrySecretStatus>>, ApiError> {
    if !valid_name(&name) {
        return Err(ApiError::BadRequest("Invalid secret name".into()));
    }
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Registry lock poisoned"))?;
    let path = dir.join("mcp_secrets.json");
    let mut secrets: BTreeMap<String, String> = read(&path)?;
    let has_value = if let Some(Json(value)) = value {
        secrets.insert(name.clone(), value.value);
        true
    } else {
        secrets.remove(&name);
        false
    };
    write(&path, &secrets, true)?;
    Ok(Json(ApiResponse::success(RegistrySecretStatus {
        name,
        has_value,
    })))
}

async fn set_secret(
    dir: Extension<PathBuf>,
    name: RoutePath<String>,
    value: Result<Json<SetRegistrySecret>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<RegistrySecretStatus>>, ApiError> {
    secret(
        dir,
        name,
        Some(value.map_err(|_| ApiError::BadRequest("Invalid secret".into()))?),
    )
    .await
}
async fn clear_secret(
    dir: Extension<PathBuf>,
    name: RoutePath<String>,
) -> Result<Json<ApiResponse<RegistrySecretStatus>>, ApiError> {
    secret(dir, name, None).await
}
async fn secret_status(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
) -> Result<Json<ApiResponse<RegistrySecretStatus>>, ApiError> {
    if !valid_name(&name) {
        return Err(ApiError::BadRequest("Invalid secret name".into()));
    }
    let secrets: BTreeMap<String, String> = read(&dir.join("mcp_secrets.json"))?;
    let has_value = secrets.contains_key(&name);
    Ok(Json(ApiResponse::success(RegistrySecretStatus {
        name,
        has_value,
    })))
}

pub(super) fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/mcp-registry/entries", get(list).post(create))
        .route("/mcp-registry/entries/{name}", put(update).delete(delete))
        .route(
            "/mcp-registry/secrets/{name}",
            get(secret_status).put(set_secret).delete(clear_secret),
        )
        .layer(Extension(utils::assets::asset_dir()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn registry_crud_and_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let app: Router = Router::new()
            .route("/entries", get(list).post(create))
            .route("/entries/{name}", put(update).delete(delete))
            .route(
                "/secrets/{name}",
                get(secret_status).put(set_secret).delete(clear_secret),
            )
            .layer(Extension(dir.path().to_path_buf()));
        async fn request(
            app: &Router,
            method: &str,
            path: &str,
            body: &str,
        ) -> (StatusCode, String) {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .header("content-type", "application/json")
                        .body(Body::from(body.to_owned()))
                        .unwrap(),
                )
                .await
                .unwrap();
            let status = response.status();
            let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            (status, String::from_utf8(bytes.to_vec()).unwrap())
        }
        let entry = r#"{"name":"server","transport":"stdio","command":"node","args":[],"url":null,"headers":{},"env":{"TOKEN":"token"},"clis":["codex"],"roles":["crew"]}"#;
        assert_eq!(
            request(&app, "POST", "/entries", entry).await.0,
            StatusCode::OK
        );
        assert_eq!(
            request(&app, "POST", "/entries", entry).await.0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            request(
                &app,
                "POST",
                "/entries",
                &entry.replace("server", "invalid.name")
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            request(&app, "POST", "/entries", &entry.replace("stdio", "http"))
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            request(
                &app,
                "PUT",
                "/entries/server",
                &entry.replace("node", "npx")
            )
            .await
            .0,
            StatusCode::OK
        );
        assert!(request(&app, "GET", "/entries", "").await.1.contains("npx"));
        let (status, response) = request(
            &app,
            "PUT",
            "/secrets/token",
            r#"{"value":"sensitive-value"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(!response.contains("sensitive-value"));
        assert!(
            !request(&app, "GET", "/entries", "")
                .await
                .1
                .contains("sensitive-value")
        );
        assert!(
            request(&app, "GET", "/secrets/token", "")
                .await
                .1
                .contains("\"has_value\":true")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(dir.path().join("mcp_secrets.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        assert!(
            request(&app, "DELETE", "/secrets/token", "")
                .await
                .1
                .contains("\"has_value\":false")
        );
        assert_eq!(
            request(&app, "DELETE", "/entries/server", "").await.0,
            StatusCode::NO_CONTENT
        );
        assert!(
            !request(&app, "GET", "/entries", "")
                .await
                .1
                .contains("server")
        );
    }
}
