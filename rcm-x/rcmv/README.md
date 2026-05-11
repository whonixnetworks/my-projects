# Rcmv

Rclone media upload manager with crypt remote support.

## Features

- Upload local media to any rclone remote (including encrypted crypts)
- Fast parallel transfers tuned for NVMe → Google Drive
- Move mode: delete local files after confirmed upload
- Push notifications (Pushover, ntfy)
- Cron scheduling for automated uploads
- Dry-run previews
- Bandwidth limiting

## Requirements

- rclone
- curl (for notifications)

## Installation

```bash
./rcmv --install
rcmv --setup
```

## Usage

```bash
rcmv --setup          # First-time configuration
rcmv --dry-run       # Preview what would be uploaded
rcmv --run           # Start upload
rcmv --run --force   # Replace cloud files with local
rcmv --run --delete-after  # Free local space after upload
rcmv --status       # Show config and connectivity
rcmv --logs        # View upload logs
rcmv --cron        # Manage cron schedule
```

## Options

- `--force` - Replace cloud duplicates with local
- `--delete-after` - Delete local files after upload
- `--background` - Silent mode for cron
- `--bwlimit <speed>` - Bandwidth cap (e.g. 10M, 512K)
- `--logs` - View logs (--tail, --errors, --full)

## Configuration

- Config: `~/.config/rcmv/config.conf`
- Logs: `~/.local/share/rcmv/upload.log`

## License

MIT