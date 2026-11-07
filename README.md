# Agent Workspace

[![Desktop builds](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml/badge.svg)](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml)

A desktop workspace for parallel development with Git worktrees, locally or over SSH. Built with Electron, TypeScript, and React for macOS, Windows, and Linux.

## Installation

[**Download the latest release**](https://github.com/sd-softdev/ai-worktrees/releases/latest), featuring an English interface, SSH workspaces, and turnkey installers. The [release pipeline](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml) tests the packaged and installed app on all four supported platforms before publishing.

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
curl -fsSL https://github.com/sd-softdev/ai-worktrees/releases/latest/download/install.sh | bash -s -- --portable --version v0.4.0
```

Use `--install-dir DIRECTORY` to choose the destination for macOS or AppImage installations. `--dry-run` displays the selected package. To update, close the app and run the script again.

### PowerShell · Windows x64

```powershell
$installer = Join-Path $env:TEMP 'agent-workspace-install.ps1'
Invoke-WebRequest -UseBasicParsing 'https://github.com/sd-softdev/ai-worktrees/releases/latest/download/install.ps1' -OutFile $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

Installs using NSIS to `%LOCALAPPDATA%\Programs\Agent Workspace`. Supports Windows PowerShell 5.1 and PowerShell 7. Optional parameters include `-Version v0.4.0`, `-InstallDirectory 'C:\Apps\Agent Workspace'`, and `-DryRun`.

### Offline installation

Download the appropriate package, `SHA256SUMS`, and installation script from the same release:

```bash
bash install.sh --version v0.4.0 --asset ./agent-workspace-0.4.0-mac-arm64.dmg --checksums ./SHA256SUMS
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Version v0.4.0 -InstallerPath .\agent-workspace-0.4.0-win-x64.exe -ChecksumPath .\SHA256SUMS
```

### In-app updates (from v0.3.0)

Click the version button in the bottom-right status bar or choose **Help → Check for updates**. Installed builds also check the latest stable GitHub release shortly after launch and every six hours. A new version is indicated in the status bar without interrupting your work.

1. Select **Download update**. Downloads show progress, can be cancelled, and are verified using SHA-512 before installation. Network failures or checksum errors can be retried.
2. **Windows (NSIS) / Linux (AppImage or DEB):** choose **Restart & install**. The native updater installs the package; DEB installations may request administrator authentication through the desktop environment.
3. **macOS:** choose **Restart & install**. The updater verifies and stages the app from the DMG, then replaces the running installation at its exact path and relaunches it. The update dialog displays this path. This works for `~/Applications`, `/Applications`, and custom writable installation folders. A failed replacement restores the previous app. An unwritable folder is reported before the app closes.

Downloads and installation require an explicit action. Quitting normally does not install a downloaded update. If terminals are running, installation asks for confirmation before closing them. Workspace layouts are saved; shells start fresh after relaunch. Development builds and unpackaged Linux executables do not self-update.

**Upgrading from v0.2.1 or earlier:** install the current release once using the installer or installation script above. Older versions do not contain the update interface.

**macOS versions v0.3.0 and v0.4.0:** their update button opens a DMG for manual installation. To get the new in-place updater, quit the app and run the installation script once with `--install-dir` pointing to the existing app's folder (the script's default is `~/Applications`). Dragging into the DMG's `/Applications` shortcut can create a second copy when the original is in `~/Applications`.

## Development setup

Requirements: Node.js 26 (matching CI), npm, and Git. The native terminal component requires additional build tools depending on your platform:

- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Windows:** Visual Studio Build Tools with “Desktop development with C++”, Windows SDK, Spectre-mitigated MSVC libraries, and Python.
- **Linux:** Python, `make`, a C++ compiler, and Electron's GTK/NSS/audio libraries. On Ubuntu 24.04, CI uses `libgtk-3-0t64`, `libnss3`, `libasound2t64`, `libgbm1`, and `libxss1`.

```sh
npm ci
npm run dev
```

Select **Open workspace** to open a checked-out Git repository. The app also discovers worktrees outside the repository directory. New worktrees are created under `.worktrees/` by default; this directory is ignored through Git's local exclude file.

## Features

- One open workspace with a worktree overview and optional task descriptions.
- Create worktrees with their own branches and remove them with checks. Removing a worktree preserves its branch and commits.
- Real shells powered by `node-pty` and `xterm.js`, with tabs and horizontal/vertical splits. macOS/Linux use the login shell; Windows uses `COMSPEC` or `cmd.exe` through ConPTY.
- Background terminals keep running when switching worktrees or tabs.
- Manual task statuses and separate shell process statuses.
- Staged, unstaged, and untracked changes, commit history, and branch diffs from the merge base.
- GitHub pull-request and GitLab merge-request badges per worktree, with review and CI status.
- File tree with text previews and readable diffs.
- Resizable sidebars and persistent layouts per repository.
- A pinned base-repository section, reorderable worktrees, and one-click Git fetch/push.
- Hosts from your OpenSSH configuration, remote folder selection, and the same worktree, Git, and file operations over SSH.
- In-app stable-release checks, verified downloads with progress and cancellation, and platform-specific installation.

Terminals start in their respective worktrees. Run regular CLI programs such as `opencode`, build commands, and development servers there. Clicking a terminal's close button terminates its process.

Git status and the file tree refresh silently in the background every five seconds and whenever the window gains focus. Existing content stays visible while refreshing. Large previews are limited in size; terminal scrollback is limited to 8,000 lines.

### Base repository and worktree order

The **Base repository** has its own fixed section above the linked worktrees. Drag a worktree by its **Reorder** handle to reorder it, or focus the handle and press **Arrow Up / Arrow Down**. Reordering is available when there are at least two linked worktrees. The order is saved per workspace and survives restarts; newly discovered worktrees are appended. Moving cards preserves active terminals and their sessions.

Click **Fetch** in the base repository to fetch all remotes without merging or changing your checkout. Click **Push** on a worktree to publish its current branch. Push uses `branch.<name>.pushRemote`, then `remote.pushDefault`, then the upstream remote, falling back to `origin` or a single configured remote. The first push sets an upstream; existing upstream tracking is preserved when pushing to a fork. A push to the upstream remote respects its target branch name. Only the selected branch is pushed, without forcing updates.

Operations show progress and success/errors on the card. They use Git's existing credentials; for SSH workspaces, Git runs on the remote host. Configure authentication there if needed. Detached worktrees cannot be pushed until a branch is checked out.

### Pull requests and merge requests

The optional **PR / MR** inspector tab uses [GitHub CLI (`gh`)](https://cli.github.com/) or [GitLab CLI (`glab`)](https://gitlab.com/gitlab-org/cli#installation) and its existing authentication. Install the appropriate CLI on PATH and sign in with `gh auth login` or `glab auth login`, then refresh the tab. Missing CLIs, missing authentication, and network failures show an informational status in this panel; Git, worktrees, and terminals continue working normally.

On macOS, apps launched through Finder may have a shorter PATH than Terminal. If a CLI is not found, the PR/MR integration also checks the PATH from your interactive login shell (including `.zprofile` and `.zshrc` for zsh). Refresh picks up shell PATH changes without restarting the app. Shell startup has a short deadline; the CLI itself runs directly with noninteractive input.

- Worktree badges show the associated request number and draft, open, merged, or closed state. The inspector adds its title, branches, review and check/pipeline status, and an **Open in browser** link. When multiple requests match, the latest updated open request is preferred, followed by the latest closed or merged request.
- GitHub.com and GitLab.com are detected from Git remotes. For self-hosted instances, select **GitHub** or **GitLab** under **PR/MR provider** and authenticate the CLI for that hostname (`gh auth login --hostname HOST` or `glab auth login --hostname HOST`). Settings are saved per workspace; **Disabled** turns off CLI queries.
- **Target remote** defaults to `upstream` when present, otherwise the branch source remote. Choose it explicitly for other layouts. Fork matching checks the source repository as well as the local branch name; push-remote overrides are respected.
- Status refreshes every 60 seconds while the window is visible, with cached results on focus and a manual refresh button. Network failures retain a clearly marked last-known status. Review/pipeline details that the server does not expose are shown as unavailable.
- For **SSH workspaces**, the CLI runs on the remote host and uses that host's installation and authentication. Install and sign in there, then refresh.

### Working over SSH

1. The remote host requires **Linux or macOS, Git, and Node.js 20+**. The repository must already be checked out on that host.
2. Optionally configure a host in `~/.ssh/config` (Windows: `%USERPROFILE%\.ssh\config`):

   ```sshconfig
   Host dev-server
     HostName dev.example.com
     User daniel
     IdentityFile ~/.ssh/id_ed25519
   ```

3. Click **Connect via SSH**, then select a configured host or enter `user@hostname`. Configure nonstandard ports and jump hosts using `Port` and `ProxyJump` in your SSH configuration.
4. Confirm the host fingerprint and enter your password or passphrase if prompted. The app uses system OpenSSH, your SSH agent, and standard `known_hosts` verification. Credentials are not stored.
5. Select the remote repository directory and click **Open repository**. If needed, specify an absolute Node.js path under **Remote runtime**.

The connection checks for Node.js 20+ and Git before starting the remote helper. Missing or outdated Node.js produces installation instructions instead of a shell or JavaScript error. Install Node.js on the host using the [official installation guide](https://nodejs.org/en/download), `nvm install --lts` if nvm is already installed, or `brew install node` on macOS with Homebrew. Then reconnect. If Node.js is already available in an interactive terminal, run `command -v node` there and enter that absolute path under **Remote runtime**.

On Windows, enable **OpenSSH Client** in **Settings → Optional features** if needed, then restart the app. The app resolves the full `ssh.exe` path for both Git/file connections and terminals.

Git and file operations use a bundled helper streamed to Node.js on the host for each connection. No separate agent installation is required. Terminals connect over SSH in the corresponding remote worktree. On macOS/Linux, terminals share the authenticated OpenSSH connection; Windows may display additional authentication prompts.

If the connection drops, click **Reconnect**. The workspace and layout are restored with **new shells**; existing remote processes are not automatically reattached. For long-lived sessions, you can use a tool such as `tmux` inside the terminal. Local and remote repositories have separate layout profiles.

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
npm run test:ssh-client
npm run test:updates
npm run test:install
```

- Integration tests use real, temporary Git repositories.
- The cross-platform desktop smoke test launches Electron and checks real PTYs, a full-screen TUI, large terminal output, worktree isolation, splits, diffs, the file tree, session switching, and layout restoration. It requires a desktop session and writes screenshots and diagnostic logs to `artifacts/`.
- `pack` creates an app directory under `dist/`. `test:packaged` automatically locates its executable for the current platform.
- Run distribution commands on their target operating system so that `node-pty` is built and tested for that system.
- `test:ssh` starts an isolated local OpenSSH server and checks host trust, encrypted keys, remote Git/file/worktree operations, terminal continuity, and reconnect. It requires `sshd` and a previously packaged app. Linux CI runs it with `AGENT_WORKSPACE_TEST_SSHD_SUDO=1`.
- `test:ssh-client` launches the real OpenSSH client through the app's terminal service using Electron's native PTY runtime. Windows CI also checks executable lookup in a final PATH entry containing spaces.
- `test:install` requires a previously built installer for the current version. It checks rejection of invalid checksums, installs to a temporary destination (system-wide for DEB), and runs the installed app through the desktop test. Windows/Linux require an isolated CI runner for this test.
- `test:updates` uses the real packaged app, updater, and a local release server to test version checks, corrupt-download rejection, cancellation, retry, and terminal confirmation. On macOS it replaces an isolated app in a custom folder, relaunches it, and verifies its new version, exact executable path, and unchanged profile; another installation stays untouched. Windows/Linux intercept the final OS installer handoff. `test:install` additionally exercises native installers and runs update tests against installed applications, including both Linux formats.
- macOS and Windows builds are currently unsigned; macOS builds are not notarized.
- `node-pty` is built for the Electron version during dependency installation. After upgrading Electron, run `npm run postinstall` if needed.

| Command              | Target                      | Package                 |
| -------------------- | --------------------------- | ----------------------- |
| `npm run dist:mac`   | macOS, current architecture | `.dmg`                  |
| `npm run dist:win`   | Windows x64                 | `.exe` (NSIS installer) |
| `npm run dist:linux` | Linux x64                   | `.AppImage`, `.deb`     |

Examples: `dist/agent-workspace-0.4.0-linux-x86_64.AppImage` and `dist/agent-workspace-0.4.0-linux-amd64.deb`. Both Linux packages target x64. AppImages may additionally require FUSE 2 (`libfuse2t64` on Ubuntu 24.04). Make the AppImage executable before launching it.

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

A tag such as `v0.4.0`, matching the version in `package.json`, automatically publishes a [GitHub release](https://github.com/sd-softdev/ai-worktrees/releases) after all four builds succeed. Releases include the packages, `install.sh`, `install.ps1`, and `SHA256SUMS`. Update manifests (`latest.yml`, `latest-linux.yml`, and `latest-mac.yml`) are assembled from the tested artifacts; the macOS manifest includes both architectures. Regular branch builds produce workflow artifacts.

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
