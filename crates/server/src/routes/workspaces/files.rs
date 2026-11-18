use std::path::{Component, Path, PathBuf};

use axum::{
    Router,
    body::Body,
    extract::{Extension, Query, State},
    http::{StatusCode, header},
    response::Response,
    routing::get,
};
use db::models::{session::Session, workspace::Workspace, workspace_repo::WorkspaceRepo};
use deployment::Deployment;
use mime_guess::MimeGuess;
use serde::Deserialize;
use services::services::{container::ContainerService, file::FileError};
use tokio::fs::File as TokioFile;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize)]
pub struct ViewImageQuery {
    pub path: String,
    pub session_id: Uuid,
}

pub async fn get_workspace_file(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ViewImageQuery>,
) -> Result<Response, ApiError> {
    if !is_safe_path(&query.path) {
        return Err(ApiError::Forbidden("Invalid file path".to_string()));
    }

    let session = Session::find_by_id(&deployment.db().pool, query.session_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Session not found".to_string()))?;
    if session.workspace_id != workspace.id {
        return Err(ApiError::Forbidden(
            "Session does not belong to workspace".to_string(),
        ));
    }

    let container_ref = deployment
        .container()
        .ensure_container_exists(&workspace)
        .await?;
    let workspace_root = PathBuf::from(container_ref);
    let base = match session.agent_working_dir.as_deref() {
        Some(dir) if !dir.is_empty() => workspace_root.join(dir),
        _ => workspace_root.clone(),
    };

    let requested = Path::new(&query.path);
    let full_path = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        base.join(requested)
    };
    let canonical_path = tokio::fs::canonicalize(&full_path)
        .await
        .map_err(|_| ApiError::File(FileError::NotFound))?;

    let content_type = MimeGuess::from_path(&canonical_path)
        .first_raw()
        .unwrap_or("application/octet-stream");
    if !is_allowed_image_type(content_type) {
        return Err(ApiError::Forbidden("Not an allowed image type".to_string()));
    }

    let mut roots = vec![
        workspace_root,
        base,
        std::env::temp_dir(),
        PathBuf::from("/tmp"),
    ];
    let repos =
        WorkspaceRepo::find_repos_for_workspace(&deployment.db().pool, workspace.id).await?;
    roots.extend(repos.into_iter().map(|repo| repo.path));
    let mut allowed = false;
    for root in roots {
        if let Ok(root) = tokio::fs::canonicalize(&root).await
            && canonical_path.starts_with(&root)
        {
            allowed = true;
        }
    }
    if !allowed {
        return Err(ApiError::Forbidden("Path not allowed".to_string()));
    }

    let file = TokioFile::open(&canonical_path)
        .await
        .map_err(|_| ApiError::File(FileError::NotFound))?;
    let metadata = file
        .metadata()
        .await
        .map_err(|_| ApiError::File(FileError::NotFound))?;
    if !metadata.is_file() {
        return Err(ApiError::File(FileError::NotFound));
    }

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, metadata.len())
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::from_stream(ReaderStream::new(file)))
        .map_err(|e| ApiError::File(FileError::ResponseBuildError(e.to_string())))
}

fn is_safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\0')
        && Path::new(path)
            .components()
            .all(|c| !matches!(c, Component::ParentDir))
}

fn is_allowed_image_type(mime_type: &str) -> bool {
    matches!(
        mime_type,
        "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp"
            | "image/bmp"
            | "image/x-icon"
            | "image/tiff"
    )
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new().route("/", get(get_workspace_file))
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_image_type, is_safe_path};

    #[test]
    fn rejects_unsafe_paths() {
        assert!(!is_safe_path(""));
        assert!(!is_safe_path("../secret.png"));
        assert!(!is_safe_path("/tmp/../etc/passwd.png"));
        assert!(!is_safe_path("a/../b.png"));
        assert!(!is_safe_path("a\0.png"));
    }

    #[test]
    fn accepts_relative_and_absolute_paths() {
        assert!(is_safe_path("image.png"));
        assert!(is_safe_path("./image.png"));
        assert!(is_safe_path("/tmp/shot.png"));
    }

    #[test]
    fn only_allows_raster_images() {
        assert!(is_allowed_image_type("image/png"));
        assert!(is_allowed_image_type("image/webp"));
        assert!(!is_allowed_image_type("image/svg+xml"));
        assert!(!is_allowed_image_type("text/html"));
        assert!(!is_allowed_image_type("application/octet-stream"));
    }
}
