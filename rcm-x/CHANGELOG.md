# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### rcmnt v1.5.0

#### Added
- Comprehensive README documentation for rcmnt
- Dependency checking in rcmnt script
- Better error handling for stale mount cleanup

#### Changed
- Updated rcmnt version from 1.4.0 to 1.5.0
- Improved default mount path from `/home/greedy/crypt` to `~/rclone-mount`
- Updated config file name from `rclone-script.conf` to `rcmnt.conf`
- Enhanced cache directory path handling for empty REMOTE_PATH
- Improved process termination (SIGTERM before SIGKILL)

#### Fixed
- Potential security issue in config loading
- Shellcheck compliance improvements
- Better handling of missing dependencies

## [2.3.0] - 2026-04-16

### Bug Fixes

- **Fixed path quoting in systemd service files** — systemd ExecStart lines now properly quote mount paths, preventing breakage when directories contain spaces
- **Fixed grep pattern matching** — changed all path-based `grep` calls to `grep -F` (fixed string matching) to prevent regex metacharacters in directory paths from causing false matches or errors
- **Fixed `show_status` indentation** — the mount point line in the status display was misaligned with other fields

### Improvements

- **Added input validation for `TRANSFERS`** — rejects non-numeric input with a clear error message instead of producing an invalid rclone config
- **Normalized `REMOTE_PATH`** — leading slashes are now stripped to prevent malformed remote paths like `remote://path`
- **Updated README** — added version badge, requirements section, command table, and CHANGELOG reference

## [2.2.0] - Previous

### Features

- Interactive setup with Standard and Merged-only modes
- Multi-instance support with unique systemd service names
- Automatic dependency installation (mergerfs, rclone, fuse)
- FUSE deadlock prevention with timeout-based mount checks
- `/proc/mounts` fallback for checking stuck FUSE mounts
- Shell alias auto-detection (bash, zsh, fish)
- Mount conflict detection (child mounts, already-mounted directories)
- Automatic `user_allow_other` configuration in fuse.conf
