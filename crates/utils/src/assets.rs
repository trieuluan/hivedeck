use directories::ProjectDirs;
use rust_embed::RustEmbed;

const PROJECT_ROOT: &str = env!("CARGO_MANIFEST_DIR");

pub fn resolve_asset_dir(override_dir: Option<&str>, is_debug: bool) -> std::path::PathBuf {
    if let Some(dir) = override_dir.map(str::trim).filter(|dir| !dir.is_empty()) {
        std::path::PathBuf::from(dir)
    } else if is_debug {
        std::path::PathBuf::from(PROJECT_ROOT).join("../../dev_assets")
    } else {
        prod_asset_dir_path()
    }
}

pub fn asset_dir() -> std::path::PathBuf {
    let override_dir = std::env::var("HIVEDECK_ASSET_DIR").ok();
    let path = resolve_asset_dir(override_dir.as_deref(), cfg!(debug_assertions));

    // Ensure the directory exists
    if !path.exists() {
        std::fs::create_dir_all(&path).expect("Failed to create asset directory");
    }

    path
    // ✔ macOS → ~/Library/Application Support/MyApp
    // ✔ Linux → ~/.local/share/myapp   (respects XDG_DATA_HOME)
    // ✔ Windows → %APPDATA%\Example\MyApp
}

pub fn prod_asset_dir_path() -> std::path::PathBuf {
    ProjectDirs::from("dev", "hivedeck", "hivedeck")
        .expect("OS didn't give us a home directory")
        .data_dir()
        .to_path_buf()
}

pub fn config_path() -> std::path::PathBuf {
    asset_dir().join("config.json")
}

pub fn profiles_path() -> std::path::PathBuf {
    asset_dir().join("profiles.json")
}

pub fn credentials_path() -> std::path::PathBuf {
    asset_dir().join("credentials.json")
}

#[derive(RustEmbed)]
#[folder = "../../assets/sounds"]
pub struct SoundAssets;

#[derive(RustEmbed)]
#[folder = "../../assets/scripts"]
pub struct ScriptAssets;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_asset_dir_prefers_non_empty_override() {
        let dir = resolve_asset_dir(Some("/tmp/custom-assets"), true);
        assert_eq!(dir, std::path::PathBuf::from("/tmp/custom-assets"));
    }

    #[test]
    fn resolve_asset_dir_ignores_blank_override() {
        let dir = resolve_asset_dir(Some("   "), true);
        assert_eq!(
            dir,
            std::path::PathBuf::from(PROJECT_ROOT).join("../../dev_assets")
        );
    }

    #[test]
    fn resolve_asset_dir_falls_back_to_prod_when_not_debug() {
        let dir = resolve_asset_dir(None, false);
        assert_eq!(dir, prod_asset_dir_path());
    }
}
