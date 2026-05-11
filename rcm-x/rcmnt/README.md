# Rcmnt - Rclone Mount Manager

`rcmnt` is a comprehensive bash script for managing rclone mounts with health checks, cache management, and monitoring capabilities.

## Features

- **Interactive Menu**: Easy-to-use terminal interface with color-coded options
- **Health Checks**: Automated mount health verification and diagnostics
- **Cache Management**: Clean old cache files and optimize storage usage
- **Log Management**: View, filter, and rotate log files
- **Bandwidth Control**: Set and manage transfer speed limits
- **Systemd Integration**: Install as user service for auto-start
- **Resource Monitoring**: Real-time CPU, memory, and process monitoring
- **Stale Mount Cleanup**: Automatic detection and cleanup of orphaned mounts

## Installation

1. Ensure you have `rclone` and `fuse` installed:
   ```bash
   # Ubuntu/Debian
   sudo apt install rclone fuse3
   
   # Or download rclone from https://rclone.org/install/
   ```

2. Make the script executable:
   ```bash
   chmod +x rcmnt
   ```

3. (Optional) Add to your PATH for easy access:
   ```bash
   sudo cp rcmnt /usr/local/bin/
   ```

## Configuration

The script uses a configuration file at `~/.config/rclone/rcmnt.conf`. You can modify settings directly or use the interactive menu.

Default configuration:
- **Remote**: `GCrypt` (change to your rclone remote name)
- **Mount Path**: `~/rclone-mount`
- **Log File**: `~/.rclone/mount.log`
- **Cache Directory**: `~/.cache/rclone/vfs/`

## Usage

### Interactive Mode (Default)
```bash
./rcmnt
# or
./rcmnt --menu
```

### Command Line Options

**Mount Operations:**
```bash
./rcmnt --mount              # Mount the remote drive
./rcmnt --unmount            # Unmount the remote drive  
./rcmnt --restart            # Restart the mount
./rcmnt --status             # Show detailed status
```

**Monitoring:**
```bash
./rcmnt --watch              # Monitor resources in real-time
./rcmnt --health             # Run health check
./rcmnt --logs --errors 100  # View last 100 error lines
./rcmnt --logs --tail        # Follow log file
```

**Maintenance:**
```bash
./rcmnt --clean-cache        # Clean old cache files
./rcmnt --rotate-logs        # Manually rotate log files
./rcmnt --save-config        # Save current configuration
./rcmnt --bwlimit 10M        # Set bandwidth limit to 10MB/s
./rcmnt --bwlimit off        # Remove bandwidth limit
```

**Service Management:**
```bash
./rcmnt --install-service    # Install systemd user service
./rcmnt --uninstall-service  # Remove systemd user service
```

**General:**
```bash
./rcmnt --help               # Show help
./rcmnt --version            # Show version
```

## Examples

1. **Basic mount with interactive setup:**
   ```bash
   ./rcmnt
   # Press 'M' to mount, 'S' for status
   ```

2. **Mount and monitor:**
   ```bash
   ./rcmnt --mount
   ./rcmnt --watch
   ```

3. **Set bandwidth limit and check health:**
   ```bash
   ./rcmnt --bwlimit 5M
   ./rcmnt --restart
   ./rcmnt --health
   ```

4. **Install as systemd service:**
   ```bash
   ./rcmnt --install-service
   systemctl --user enable rclone-GCrypt.service
   systemctl --user start rclone-GCrypt.service
   ```

## Systemd Service

When installed as a systemd user service:
- Service file: `~/.config/systemd/user/rclone-<REMOTE>.service`
- Auto-starts on login (if enabled)
- Managed via `systemctl --user` commands
- Logs to both journal and `~/.rclone/mount.log`

## Troubleshooting

### Common Issues

1. **"Missing dependencies" error:**
   ```bash
   # Install required packages
   sudo apt install rclone fuse3
   ```

2. **"Permission denied" when mounting:**
   ```bash
   # Check /etc/fuse.conf
   sudo nano /etc/fuse.conf
   # Uncomment: user_allow_other
   ```

3. **Stale mount cleanup:**
   ```bash
   ./rcmnt --unmount
   fusermount3 -uz ~/rclone-mount  # or fusermount
   ```

4. **View detailed errors:**
   ```bash
   ./rcmnt --logs --errors
   tail -f ~/.rclone/mount.log
   ```

### Log Files
- Primary log: `~/.rclone/mount.log`
- Rotated logs: `~/.rclone/mount.log.1`, `.log.2`, etc.
- Logs auto-rotate at 100MB, keeping 5 files

## Performance Tips

1. **Cache Settings**: Adjust in the rclone mount command:
   - `--vfs-cache-max-size`: Default 20G
   - `--vfs-cache-max-age`: Default 72h
   - `--vfs-read-ahead`: Default 2G

2. **Bandwidth Limits**: Use `--bwlimit` to prevent network saturation

3. **Parallel Transfers**: Default is 8 transfers, 8 checkers

4. **Chunk Sizes**: Optimized for large file transfers (64M chunks, 512M limit)

## Related Projects

- [RCM-X](https://github.com/greedy/rcm-x): Main project with rclone + mergerfs setup
- [rcmv](https://github.com/greedy/rcm-x/tree/main/rcmv): Rclone move utility
- [rclone](https://rclone.org): Cloud storage synchronization tool

## License

MIT License - see the main project LICENSE file for details.

## Version

Current version: 1.5.0