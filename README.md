# Agent Workspace

[![Desktop builds](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml/badge.svg)](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml)

A desktop workspace for parallel development with Git worktrees, locally or over SSH. Built with Electron, TypeScript, and React for macOS, Windows, and Linux.

## Installation

[**Download v0.2.0**](https://github.com/sd-softdev/ai-worktrees/releases/tag/v0.2.0), featuring SSH workspaces and turnkey installers. All four platform builds passed their packaged-app and installation tests in the [release pipeline](https://github.com/sd-softdev/ai-worktrees/actions/runs/41925926785). Installation from the public release was also verified on macOS ARM64.

The scripts download the appropriate package from the [latest GitHub release](https://github.com/sd-softdev/ai-worktrees/releases/latest), verify its SHA-256 checksum, and install the app. Node.js is only required locally when developing the app. Local repositories require Git; SSH connections require the OpenSSH client.

### Bash · macOS / Linux

```bash
curl -fsSL https://github.com/sd-softdev/ai-worktrees/releases/latest/download/install.sh | bash
```

- **macOS ARM64 / Intel:** installs from the DMG to `~/Applications/Agent Workspace.app`.
- **Debian/Ubuntu x64:** installs the DEB using `apt-get`, with `sudo` if needed.
- **Other Linux distributions, x64:** installs an AppImage to `~/.local/share/agent-workspace`, with an application menu entry and a launcher at `~/.local/bin/agent-workspace`. FUSE 2 is required.

Pass options using `bash -s --`, for example to install the portable Linux package:

```bash
curl -fsSL https://github.com/sd-softdev/ai-worktrees/releases/latest/download/install.sh | bash -s -- --portable --version v0.2.0
```

Use `--install-dir DIRECTORY` to choose the destination for macOS or AppImage installations. `--dry-run` displays the selected package. To update, close the app and run the script again.

### PowerShell · Windows x64

```powershell
$installer = Join-Path $env:TEMP 'agent-workspace-install.ps1'
Invoke-WebRequest -UseBasicParsing 'https://github.com/sd-softdev/ai-worktrees/releases/latest/download/install.ps1' -OutFile $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

Installs using NSIS to `%LOCALAPPDATA%\Programs\Agent Workspace`. Supports Windows PowerShell 5.1 and PowerShell 7. Optional parameters include `-Version v0.2.0`, `-InstallDirectory 'C:\Apps\Agent Workspace'`, and `-DryRun`.

### Offline installation

Download the appropriate package, `SHA256SUMS`, and installation script from the same release:

```bash
bash install.sh --version v0.2.0 --asset ./agent-workspace-0.2.0-mac-arm64.dmg --checksums ./SHA256SUMS
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Version v0.2.0 -InstallerPath .\agent-workspace-0.2.0-win-x64.exe -ChecksumPath .\SHA256SUMS
```

## Development setup

Requirements: Node.js 26 (matching CI), npm, and Git. The native terminal component requires additional build tools depending on your platform:

- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Windows:** Visual Studio Build Tools with “Desktop development with C++”, Windows SDK, Spectre-mitigated MSVC libraries, and Python.
- **Linux:** Python, `make`, a C++ compiler, and Electron's GTK/NSS/audio libraries. On Ubuntu 24.04, CI uses `libgtk-3-0t64`, `libnss3`, `libasound2t64`, `libgbm1`, and `libxss1`.

```sh
npm ci
npm run dev
```

The app's interface currently uses German labels. Select **Workspace öffnen** (Open workspace) to open a checked-out Git repository. The app also discovers worktrees outside the repository directory. New worktrees are created under `.worktrees/` by default; this directory is ignored through Git's local exclude file.

## Features

- One open workspace with a worktree overview and optional task descriptions.
- Create worktrees with their own branches and remove them with checks. Removing a worktree preserves its branch and commits.
- Real shells powered by `node-pty` and `xterm.js`, with tabs and horizontal/vertical splits. macOS/Linux use the login shell; Windows uses `COMSPEC` or `cmd.exe` through ConPTY.
- Background terminals keep running when switching worktrees or tabs.
- Manual task statuses and separate shell process statuses.
- Staged, unstaged, and untracked changes, commit history, and branch diffs from the merge base.
- File tree with text previews and readable diffs.
- Resizable sidebars and persistent layouts per repository.
- Hosts from your OpenSSH configuration, remote folder selection, and the same worktree, Git, and file operations over SSH.

Terminals start in their respective worktrees. Run regular CLI programs such as `opencode`, build commands, and development servers there. Clicking a terminal's close button terminates its process.

Git status and the file tree refresh every five seconds and whenever the window gains focus. Large previews are limited in size; terminal scrollback is limited to 8,000 lines.

### Working over SSH

1. The remote host requires **Linux or macOS, Git, and Node.js 20+**. The repository must already be checked out on that host.
2. Optionally configure a host in `~/.ssh/config` (Windows: `%USERPROFILE%\.ssh\config`):

   ```sshconfig
   Host dev-server
     HostName dev.example.com
     User daniel
     IdentityFile ~/.ssh/id_ed25519
   ```

3. Click **SSH verbinden** (Connect via SSH), then select a configured host or enter `user@hostname`. Configure nonstandard ports and jump hosts using `Port` and `ProxyJump` in your SSH configuration.
4. Confirm the host fingerprint and enter your password or passphrase if prompted. The app uses system OpenSSH, your SSH agent, and standard `known_hosts` verification. Credentials are not stored.
5. Select the remote repository directory and click **Repository öffnen** (Open repository). If needed, specify an absolute Node.js path under **Remote-Laufzeit** (Remote runtime).

Git and file operations use a bundled helper streamed to Node.js on the host for each connection. No separate agent installation is required. Terminals connect over SSH in the corresponding remote worktree. On macOS/Linux, terminals share the authenticated OpenSSH connection; Windows may display additional authentication prompts.

If the connection drops, click **Wiederverbinden** (Reconnect). The workspace and layout are restored with **new shells**; existing remote processes are not automatically reattached. For long-lived sessions, you can use a tool such as `tmux` inside the terminal. Local and remote repositories have separate layout profiles.

### Keyboard shortcuts

| Action               | macOS | Windows/Linux  |
| -------------------- | ----- | -------------- |
| Open workspace       | `⌘O`  | `Ctrl+O`       |
| New terminal         | `⌘T`  | `Ctrl+T`       |
| Split side by side   | `⌘D`  | `Ctrl+D`       |
| Split top and bottom | `⌘⇧D` | `Ctrl+Shift+D` |

Double-click a terminal tab to rename it. Press Escape to close dialogs. Sidebar dividers can also be adjusted using the keyboard.

## Sessions and data

Tasks, layouts, the target branch, and the current selection are stored in the `workspaces` subdirectory of Electron's app user-data directory (under `~/Library/Application Support/` on macOS). Git remains the source of truth for repository state and worktrees.

Switching to another repository or quitting the app terminates running terminal processes after confirmation. On the next launch, the layout is restored with **new shell sessions**. AI agent sessions are not resumed automatically.

## Testing and building

```sh
npm run typecheck
npm test
npm run test:smoke
npm run pack
npm run dist:mac
npm run dist:win
npm run dist:linux
npm run test:packaged
npm run test:ssh
npm run test:install
```

- Integration tests use real, temporary Git repositories.
- The cross-platform desktop smoke test launches Electron and checks real PTYs, a full-screen TUI, large terminal output, worktree isolation, splits, diffs, the file tree, session switching, and layout restoration. It requires a desktop session and writes screenshots and diagnostic logs to `artifacts/`.
- `pack` creates an app directory under `dist/`. `test:packaged` automatically locates its executable for the current platform.
- Run distribution commands on their target operating system so that `node-pty` is built and tested for that system.
- `test:ssh` starts an isolated local OpenSSH server and checks host trust, encrypted keys, remote Git/file/worktree operations, terminal continuity, and reconnect. It requires `sshd` and a previously packaged app. Linux CI runs it with `AGENT_WORKSPACE_TEST_SSHD_SUDO=1`.
- `test:install` requires a previously built installer for the current version. It checks rejection of invalid checksums, installs to a temporary destination (system-wide for DEB), and runs the installed app through the desktop test. Windows/Linux require an isolated CI runner for this test.
- macOS and Windows builds are currently unsigned; macOS builds are not notarized.
- `node-pty` is built for the Electron version during dependency installation. After upgrading Electron, run `npm run postinstall` if needed.

| Command              | Target                      | Package                 |
| -------------------- | --------------------------- | ----------------------- |
| `npm run dist:mac`   | macOS, current architecture | `.dmg`                  |
| `npm run dist:win`   | Windows x64                 | `.exe` (NSIS installer) |
| `npm run dist:linux` | Linux x64                   | `.AppImage`, `.deb`     |

Examples: `dist/agent-workspace-0.2.0-linux-x86_64.AppImage` and `dist/agent-workspace-0.2.0-linux-amd64.deb`. Both Linux packages target x64. AppImages may additionally require FUSE 2 (`libfuse2t64` on Ubuntu 24.04). Make the AppImage executable before launching it.

Set `AGENT_WORKSPACE_EXECUTABLE` to test a different app executable. Use Xvfb for headless Linux tests:

```sh
xvfb-run --auto-servernum --server-args="-screen 0 1600x1000x24" npm run test:packaged
```

CI sets `AGENT_WORKSPACE_SMOKE_NO_SANDBOX=1` for these tests because the Linux runner lacks the permissions required by Chromium's sandbox. This setting only affects test launches.

## GitHub Actions and downloads

The [desktop pipeline](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml) runs on pushes to `main`, pull requests, version tags, and manual dispatches. It builds natively on four runners:

- macOS ARM64 (`macos-15`)
- macOS Intel (`macos-15-intel`)
- Windows x64 (`windows-2022`)
- Linux x64 (`ubuntu-24.04`)

Each job runs `npm ci`, checks formatting, runs integration tests, builds the installers, and launches the **packaged app** in the desktop smoke test. It then tests the turnkey scripts, including actual installation and launch of the installed app. Linux also runs the SSH end-to-end test. Installers are uploaded as `installers-*` artifacts only after the tests pass; screenshots and logs are available as `diagnostics-*`. Artifacts are retained for seven days.

A tag such as `v0.2.0`, matching the version in `package.json`, automatically publishes a [GitHub release](https://github.com/sd-softdev/ai-worktrees/releases) after all four builds succeed. Releases include the packages, `install.sh`, `install.ps1`, and `SHA256SUMS`. Regular branch builds produce workflow artifacts.

## Project structure

```text
src/main/       Git, filesystem, PTY processes, persistence, Electron lifecycle
src/preload/    Typed, restricted IPC interface
src/shared/     Shared types and terminal layout model
src/renderer/   React interface and xterm.js
src/remote/     Bundled Node.js helper for SSH hosts
tests/          Git, filesystem, and layout integration tests
scripts/        Build, desktop, SSH, and installation tests
```

Worktree setup automation, port/database isolation, and agent-specific status integrations are planned for later.
