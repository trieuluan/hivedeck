use std::{
    collections::BTreeMap,
    ffi::OsStr,
    path::{Component, Path, PathBuf},
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Path as AxumPath, Query, Request},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tower::ServiceExt;
use tower_http::services::ServeFile;
use utils::response::ApiResponse;
use uuid::Uuid;

#[derive(Serialize)]
struct Artifact {
    path: String,
    name: String,
    mime: String,
    size: u64,
    execution_id: Uuid,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct ArtifactQuery {
    path: Option<String>,
}

type Error = (StatusCode, String);

fn io_error(error: std::io::Error) -> Error {
    let status = if error.kind() == std::io::ErrorKind::NotFound {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };
    (status, error.to_string())
}

fn resolve(issue_dir: &Path, path: &str) -> Result<PathBuf, Error> {
    let relative = Path::new(path);
    if relative.as_os_str().is_empty()
        || !relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err((StatusCode::BAD_REQUEST, "Invalid artifact path".into()));
    }
    if !issue_dir
        .symlink_metadata()
        .map_err(io_error)?
        .file_type()
        .is_dir()
    {
        return Err((StatusCode::BAD_REQUEST, "Invalid issue directory".into()));
    }
    let root = issue_dir.canonicalize().map_err(io_error)?;
    let mut current = root.clone();
    for component in relative.components() {
        current.push(component);
        if current
            .symlink_metadata()
            .map_err(io_error)?
            .file_type()
            .is_symlink()
        {
            return Err((StatusCode::BAD_REQUEST, "Invalid artifact path".into()));
        }
    }
    let target = root.join(relative).canonicalize().map_err(io_error)?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err((StatusCode::BAD_REQUEST, "Invalid artifact path".into()));
    }
    Ok(target)
}

const MAX_ARTIFACTS_COLLECTED: usize = 500;

fn should_skip_artifact_dir(name: &OsStr) -> bool {
    matches!(
        name.to_str(),
        Some("node_modules" | "target" | "main-target" | ".git" | ".next" | "dist" | ".turbo")
    )
}

fn collect(
    issue_dir: &Path,
    dir: &Path,
    execution_id: Uuid,
    files: &mut Vec<Artifact>,
) -> Result<(), Error> {
    if files.len() >= MAX_ARTIFACTS_COLLECTED {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(io_error)? {
        if files.len() >= MAX_ARTIFACTS_COLLECTED {
            break;
        }
        let entry = entry.map_err(io_error)?;
        let kind = entry.file_type().map_err(io_error)?;
        if kind.is_dir() {
            if should_skip_artifact_dir(&entry.file_name()) {
                continue;
            }
            collect(issue_dir, &entry.path(), execution_id, files)?;
        } else if kind.is_file() {
            let metadata = entry.metadata().map_err(io_error)?;
            let path = entry.path();
            let relative = path
                .strip_prefix(issue_dir)
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            files.push(Artifact {
                path: relative.to_string_lossy().into_owned(),
                name: entry.file_name().to_string_lossy().into_owned(),
                mime: mime_guess::from_path(&path)
                    .first_or_octet_stream()
                    .to_string(),
                size: metadata.len(),
                execution_id,
                created_at: metadata
                    .created()
                    .or_else(|_| metadata.modified())
                    .map(DateTime::<Utc>::from)
                    .map_err(io_error)?,
            });
        }
    }
    Ok(())
}

fn list(issue_dir: &Path) -> Result<Vec<Artifact>, Error> {
    let mut files = Vec::new();
    match issue_dir.symlink_metadata() {
        Ok(metadata) if !metadata.file_type().is_dir() => {
            return Err((StatusCode::BAD_REQUEST, "Invalid issue directory".into()));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(files),
        Err(error) => return Err(io_error(error)),
        _ => {}
    }
    let entries = match std::fs::read_dir(issue_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(files),
        Err(error) => return Err(io_error(error)),
    };
    for entry in entries {
        let entry = entry.map_err(io_error)?;
        if entry.file_type().map_err(io_error)?.is_dir()
            && let Ok(execution_id) = entry.file_name().to_string_lossy().parse()
        {
            collect(issue_dir, &entry.path(), execution_id, &mut files)?;
        }
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

async fn issue_list(
    AxumPath(issue_id): AxumPath<Uuid>,
) -> Result<Json<ApiResponse<Vec<Artifact>>>, Error> {
    let files = list(
        &utils::path::artifacts_dir()
            .map_err(io_error)?
            .join(issue_id.to_string()),
    )?;
    Ok(Json(ApiResponse::success(files)))
}

async fn global_list() -> Result<Json<ApiResponse<BTreeMap<Uuid, Vec<Artifact>>>>, Error> {
    let root = utils::path::artifacts_dir().map_err(io_error)?;
    let mut issues = BTreeMap::new();
    match std::fs::read_dir(&root) {
        Ok(entries) => {
            for entry in entries {
                let entry = entry.map_err(io_error)?;
                if entry.file_type().map_err(io_error)?.is_dir()
                    && let Ok(issue_id) = entry.file_name().to_string_lossy().parse()
                {
                    let files = list(&entry.path())?;
                    if !files.is_empty() {
                        issues.insert(issue_id, files);
                    }
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error(error)),
    }
    Ok(Json(ApiResponse::success(issues)))
}

async fn file(
    AxumPath(issue_id): AxumPath<Uuid>,
    Query(query): Query<ArtifactQuery>,
    request: Request,
) -> Result<Response, Error> {
    let path = query
        .path
        .ok_or((StatusCode::BAD_REQUEST, "Missing path".into()))?;
    let issue_dir = utils::path::artifacts_dir()
        .map_err(io_error)?
        .join(issue_id.to_string());
    let target = resolve(&issue_dir, &path)?;
    let response = ServeFile::new(target)
        .oneshot(request.map(Body::new))
        .await
        .unwrap_or_else(|error| match error {});
    Ok(response.into_response())
}

async fn delete(
    AxumPath(issue_id): AxumPath<Uuid>,
    Query(query): Query<ArtifactQuery>,
) -> Result<Json<ApiResponse<()>>, Error> {
    let issue_dir = utils::path::artifacts_dir()
        .map_err(io_error)?
        .join(issue_id.to_string());
    if let Some(path) = query.path {
        std::fs::remove_file(resolve(&issue_dir, &path)?).map_err(io_error)?;
    } else if issue_dir
        .symlink_metadata()
        .map_err(io_error)?
        .file_type()
        .is_dir()
    {
        std::fs::remove_dir_all(issue_dir).map_err(io_error)?;
    } else {
        return Err((StatusCode::BAD_REQUEST, "Invalid issue directory".into()));
    }
    Ok(Json(ApiResponse::success(())))
}

pub fn router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new()
        .route("/artifacts", get(global_list))
        .route(
            "/issues/{issue_id}/artifacts",
            get(issue_list).delete(delete),
        )
        .route("/issues/{issue_id}/artifacts/file", get(file))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::to_bytes,
        http::{Request, header},
    };

    #[tokio::test]
    async fn lists_validates_serves_and_removes_artifacts() {
        let temp = tempfile::tempdir().unwrap();
        let issue = temp.path().join(Uuid::new_v4().to_string());
        let execution = Uuid::new_v4();
        let dir = issue.join(execution.to_string());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("movie.mp4"), b"0123456789").unwrap();
        let files = list(&issue).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].execution_id, execution);
        assert_eq!(files[0].mime, "video/mp4");
        assert_eq!(files[0].size, 10);
        assert_eq!(
            resolve(&issue, "../movie.mp4").unwrap_err().0,
            StatusCode::BAD_REQUEST
        );
        let target = resolve(&issue, &files[0].path).unwrap();
        let response = ServeFile::new(&target)
            .oneshot(
                Request::builder()
                    .header(header::RANGE, "bytes=0-3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "video/mp4");
        std::fs::remove_file(target).unwrap();
        assert!(list(&issue).unwrap().is_empty());
    }

    #[tokio::test]
    async fn api_preserves_artifacts_after_workspace_cleanup_and_deletes_only_requested_files() {
        let issue_id = Uuid::new_v4();
        let execution_id = Uuid::new_v4();
        let issue_dir = utils::path::artifacts_dir()
            .unwrap()
            .join(issue_id.to_string());
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(issue_dir.clone());
        let dir = issue_dir.join(execution_id.to_string());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("movie.mp4"), b"0123456789").unwrap();
        std::fs::write(dir.join("report.txt"), b"report").unwrap();
        let app = router::<()>();
        let base = format!("/issues/{issue_id}/artifacts");
        let relative = format!("{execution_id}/movie.mp4");

        let response = app
            .clone()
            .oneshot(Request::builder().uri(&base).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let json: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(json["data"].as_array().unwrap().len(), 2);
        assert_eq!(json["data"][0]["path"], relative);
        assert_eq!(json["data"][0]["name"], "movie.mp4");
        assert_eq!(json["data"][0]["mime"], "video/mp4");
        assert_eq!(json["data"][0]["size"], 10);
        assert_eq!(json["data"][0]["execution_id"], execution_id.to_string());
        assert!(json["data"][0]["created_at"].is_string());

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("{base}/file?path={relative}"))
                    .header(header::RANGE, "bytes=2-5")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            &to_bytes(response.into_body(), usize::MAX).await.unwrap()[..],
            b"2345"
        );
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("{base}/file?path=..%2Fsecret"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let workspace = tempfile::tempdir().unwrap();
        std::fs::write(workspace.path().join("worktree-file"), b"temporary").unwrap();
        workspace_manager::WorkspaceManager::cleanup_workspace(workspace.path(), &[])
            .await
            .unwrap();
        assert!(!workspace.path().exists());
        assert_eq!(std::fs::read(dir.join("movie.mp4")).unwrap(), b"0123456789");

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("{base}?path={relative}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!dir.join("movie.mp4").exists());
        assert!(dir.join("report.txt").exists());
        let response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(&base)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!issue_dir.exists());
    }
}
