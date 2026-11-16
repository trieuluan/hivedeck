use command_group::AsyncGroupChild;
#[cfg(unix)]
use tokio::time::Duration;

pub async fn kill_process_group(child: &mut AsyncGroupChild) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        // Use command_group's UnixChildExt::signal() which calls killpg()
        // with the pgid captured at spawn time. This works even after the
        // group leader has exited, unlike getpgid() which would fail.
        use command_group::{Signal, UnixChildExt};

        for sig in [Signal::SIGINT, Signal::SIGTERM, Signal::SIGKILL] {
            tracing::info!("Sending {:?} to process group", sig);
            if let Err(e) = child.signal(sig) {
                // break if the group does not exist anymore
                if e.raw_os_error() == Some(nix::libc::ESRCH) {
                    break;
                }
                tracing::warn!("Failed to send signal {:?} to process group: {}", sig, e);
            }
            if sig != Signal::SIGKILL {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }

    let _ = child.kill().await;
    let _ = child.wait().await;
    Ok(())
}

/// Whether a process with this PID currently exists.
pub fn is_pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        use nix::{sys::signal::kill, unistd::Pid};
        match kill(Pid::from_raw(pid as i32), None) {
            Ok(()) => true,
            // EPERM: exists but owned by someone else.
            Err(nix::errno::Errno::EPERM) => true,
            Err(_) => false,
        }
    }
    #[cfg(windows)]
    {
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
}

/// Terminate the process group led by `pid` (a process spawned with
/// `group_spawn*`), escalating SIGTERM → SIGKILL. Works without the original
/// child handle, e.g. after a restart, given a PID recorded in a pid file.
pub async fn terminate_process_group_by_pid(pid: u32) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use nix::{
            sys::signal::{Signal, killpg},
            unistd::Pid,
        };
        let pgid = Pid::from_raw(pid as i32);
        for sig in [Signal::SIGTERM, Signal::SIGKILL] {
            match killpg(pgid, sig) {
                Ok(()) => {}
                Err(nix::errno::Errno::ESRCH) => return Ok(()),
                Err(e) => return Err(std::io::Error::other(e)),
            }
            if sig == Signal::SIGTERM {
                for _ in 0..30 {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    if !is_pid_alive(pid) {
                        return Ok(());
                    }
                }
            }
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        let status = tokio::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .await?;
        if status.success() || !is_pid_alive(pid) {
            Ok(())
        } else {
            Err(std::io::Error::other(format!(
                "taskkill failed for PID {pid}"
            )))
        }
    }
}
