# Agent Workspace

[![Desktop builds](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml/badge.svg)](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml)

Ein Desktop-Workspace für parallele Entwicklung mit Git Worktrees – lokal oder über SSH. Gebaut mit Electron, TypeScript und React für macOS, Windows und Linux.

## Installieren

Die Skripte laden das passende Paket aus dem neuesten [GitHub-Release](https://github.com/sd-softdev/ai-worktrees/releases/latest), prüfen dessen SHA-256-Prüfsumme und installieren die App. Node.js wird auf dem lokalen Rechner nur für die Entwicklung benötigt; für lokale Repositories muss Git installiert sein, für SSH-Verbindungen der OpenSSH-Client.

### Bash · macOS / Linux

```bash
curl -fsSL https://github.com/sd-softdev/ai-worktrees/releases/latest/download/install.sh | bash
```

- **macOS ARM64 / Intel:** installiert aus dem DMG nach `~/Applications/Agent Workspace.app`.
- **Debian/Ubuntu x64:** installiert das DEB mit `apt-get` und bei Bedarf `sudo`.
- **Andere Linux-Systeme x64:** installiert ein AppImage nach `~/.local/share/agent-workspace`, mit Startmenü-Eintrag und `~/.local/bin/agent-workspace`. Dafür wird FUSE 2 benötigt.

Optionen lassen sich mit `bash -s --` übergeben, zum Beispiel für ein portables Linux-Paket:

```bash
curl -fsSL https://github.com/sd-softdev/ai-worktrees/releases/latest/download/install.sh | bash -s -- --portable --version v0.2.0
```

`--install-dir VERZEICHNIS` setzt das Ziel für macOS/AppImage, `--dry-run` zeigt die Paketauswahl. Zum Aktualisieren die App schließen und das Skript erneut ausführen.

### PowerShell · Windows x64

```powershell
$installer = Join-Path $env:TEMP 'agent-workspace-install.ps1'
Invoke-WebRequest -UseBasicParsing 'https://github.com/sd-softdev/ai-worktrees/releases/latest/download/install.ps1' -OutFile $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

Installiert per NSIS nach `%LOCALAPPDATA%\Programs\Agent Workspace`. Unterstützt Windows PowerShell 5.1 und PowerShell 7; optionale Parameter sind `-Version v0.2.0`, `-InstallDirectory 'C:\Apps\Agent Workspace'` und `-DryRun`.

### Offline installieren

Passendes Paket, `SHA256SUMS` und Installationsskript aus demselben Release herunterladen:

```bash
bash install.sh --version v0.2.0 --asset ./agent-workspace-0.2.0-mac-arm64.dmg --checksums ./SHA256SUMS
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Version v0.2.0 -InstallerPath .\agent-workspace-0.2.0-win-x64.exe -ChecksumPath .\SHA256SUMS
```

## Entwicklung starten

Voraussetzungen: Node.js 26 (wie in CI), npm und Git. Für den nativen Terminal-Unterbau werden je nach Plattform zusätzliche Build-Werkzeuge benötigt:

- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Windows:** Visual Studio Build Tools mit „Desktop development with C++“, Windows SDK, Spectre-mitigated MSVC libraries und Python.
- **Linux:** Python, `make`, ein C++-Compiler sowie die GTK-/NSS-/Audio-Bibliotheken für Electron. Unter Ubuntu 24.04 verwendet die CI `libgtk-3-0t64`, `libnss3`, `libasound2t64`, `libgbm1` und `libxss1`.

```sh
npm ci
npm run dev
```

Über **Workspace öffnen** ein ausgechecktes Git-Repository auswählen. Die App erkennt auch Worktrees außerhalb des Repository-Ordners. Neue Worktrees entstehen standardmäßig unter `.worktrees/`; dieser Ordner wird über die lokale Git-Exclude-Datei ignoriert.

## Funktionen

- Ein geöffneter Workspace mit Worktree-Übersicht und optionalen Aufgabenbeschreibungen.
- Worktrees mit eigenem Branch erstellen und kontrolliert entfernen. Beim Entfernen bleiben Branches und Commits erhalten.
- Echte Shells über `node-pty` und `xterm.js`, mit Tabs und horizontalen/vertikalen Splits. macOS/Linux verwenden die Login-Shell, Windows verwendet `COMSPEC` beziehungsweise `cmd.exe` über ConPTY.
- Hintergrundterminals laufen beim Worktree- oder Tab-Wechsel weiter.
- Manuelle Aufgabenstatus und separat ausgewiesene Shell-Prozesszustände.
- Staged-/unstaged-/untracked-Änderungen, Commit-History, Branch-Diffs ab Merge-Base.
- Dateibaum mit Textvorschau und lesbare Diffs.
- Verstellbare Seitenleisten und persistente Layouts je Repository.
- SSH-Hosts aus der OpenSSH-Konfiguration, Remote-Ordnerauswahl und dieselben Worktree-/Git-/Dateifunktionen auf dem Remote-Host.

Terminals starten im jeweiligen Worktree. Dort lassen sich reguläre CLI-Programme wie `opencode`, Build-Kommandos und Entwicklungsserver starten. Ein Klick auf das Schließen-Symbol beendet den zugehörigen Terminalprozess.

Git-Status und Dateibaum werden alle fünf Sekunden und beim Aktivieren des Fensters aktualisiert. Große Vorschauen sind begrenzt, der Terminal-Scrollback umfasst 8.000 Zeilen.

### Über SSH arbeiten

1. Auf dem Remote-Host werden **Linux oder macOS, Git und Node.js 20+** benötigt. Das Repository muss dort bereits ausgecheckt sein.
2. Optional einen Host in `~/.ssh/config` konfigurieren (Windows: `%USERPROFILE%\.ssh\config`):

   ```sshconfig
   Host dev-server
     HostName dev.example.com
     User daniel
     IdentityFile ~/.ssh/id_ed25519
   ```

3. In der App **SSH verbinden** wählen, einen konfigurierten Host auswählen oder `user@hostname` eingeben. Nichtstandard-Ports und Sprungserver werden über `Port` beziehungsweise `ProxyJump` in der SSH-Konfiguration eingerichtet.
4. Host-Fingerabdruck bestätigen und gegebenenfalls Passwort/Passphrase eingeben. Die App verwendet System-OpenSSH, den SSH-Agent und die übliche `known_hosts`-Prüfung; Zugangsdaten werden nicht gespeichert.
5. Den Remote-Repository-Ordner auswählen und **Repository öffnen** klicken. Unter **Remote-Laufzeit** kann bei Bedarf ein absoluter Node.js-Pfad angegeben werden.

Git und Dateizugriffe laufen über einen gebündelten Helper, der für jede Verbindung an Node.js auf dem Host übertragen wird. Es ist keine separate Agent-Installation nötig. Terminals starten per SSH im jeweiligen Remote-Worktree; unter macOS/Linux teilen sie die authentifizierte OpenSSH-Verbindung, unter Windows können weitere Authentifizierungsabfragen auftreten.

Bei Verbindungsabbruch erscheint **Wiederverbinden**. Workspace und Layout werden mit **neuen Shells** wiederhergestellt; laufende Remote-Prozesse werden nicht automatisch wieder angehängt. Für langlebige Sitzungen kann im Terminal beispielsweise `tmux` verwendet werden. Lokale und entfernte Repositories haben getrennte Layoutprofile.

### Tastatur

| Aktion               | macOS | Windows/Linux     |
| -------------------- | ----- | ----------------- |
| Workspace öffnen     | `⌘O`  | `Strg+O`          |
| Neues Terminal       | `⌘T`  | `Strg+T`          |
| Nebeneinander teilen | `⌘D`  | `Strg+D`          |
| Untereinander teilen | `⌘⇧D` | `Strg+Umschalt+D` |

Terminal-Tabs lassen sich per Doppelklick umbenennen. Dialoge sind per Escape schließbar; Seitenleisten-Trenner können per Tastatur bewegt werden.

## Sitzungen und Daten

Aufgaben, Layouts, Zielbranch und Auswahl werden im `workspaces`-Unterordner von Electrons App-Benutzerverzeichnis gespeichert (auf macOS unter `~/Library/Application Support/`). Git bleibt die maßgebliche Quelle für Repository-Zustand und Worktrees.

Beim Wechsel zu einem anderen Repository oder beim Beenden der App werden laufende Terminalprozesse nach Bestätigung beendet. Beim nächsten Start wird das Layout mit **neuen Shell-Sitzungen** wiederhergestellt. Agentensitzungen werden nicht automatisch fortgesetzt.

## Prüfen und bauen

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

- Integrationstests verwenden temporäre echte Git-Repositories.
- Der plattformübergreifende Desktop-Smoke-Test startet Electron und prüft echte PTYs, eine Vollbild-TUI, große Terminalausgabe, Worktree-Isolation, Splits, Diffs, Dateibaum, Session-Wechsel und Layout-Wiederherstellung. Er benötigt eine Desktop-Sitzung und erzeugt Screenshots und Diagnoselogs unter `artifacts/`.
- `pack` erzeugt ein App-Verzeichnis unter `dist/`. `test:packaged` findet dessen ausführbare Datei automatisch auf der aktuellen Plattform.
- Die Distributionsbefehle werden auf dem jeweiligen Zielbetriebssystem ausgeführt, damit auch `node-pty` für dieses System gebaut und getestet wird.
- `test:ssh` startet einen isolierten lokalen OpenSSH-Server und prüft Host-Vertrauen, verschlüsselte Schlüssel, Remote-Git/Dateien/Worktrees, Terminalkontinuität und Reconnect. Benötigt `sshd` und ein zuvor gepacktes Programm; auf Linux läuft der Test in CI mit `AGENT_WORKSPACE_TEST_SSHD_SUDO=1`.
- `test:install` benötigt einen zuvor gebauten Installer der aktuellen Version. Es prüft die Zurückweisung falscher Prüfsummen, installiert in ein temporäres Ziel (DEB systemweit) und startet die installierte App im Desktop-Test. Windows/Linux benötigen dafür einen isolierten CI-Runner.
- macOS- und Windows-Builds sind derzeit unsigniert; macOS ist nicht notarisiert.
- `node-pty` wird beim Installieren für die Electron-Version gebaut. Nach einem Electron-Update bei Bedarf `npm run postinstall` ausführen.

| Befehl               | Ziel                        | Paket                   |
| -------------------- | --------------------------- | ----------------------- |
| `npm run dist:mac`   | macOS, aktuelle Architektur | `.dmg`                  |
| `npm run dist:win`   | Windows x64                 | `.exe` (NSIS-Installer) |
| `npm run dist:linux` | Linux x64                   | `.AppImage`, `.deb`     |

Beispiele: `dist/agent-workspace-0.2.0-linux-x86_64.AppImage` und `dist/agent-workspace-0.2.0-linux-amd64.deb`. Beide Linux-Pakete sind für x64. Für AppImages kann zusätzlich FUSE 2 erforderlich sein (`libfuse2t64` auf Ubuntu 24.04). Das AppImage vor dem Start ausführbar machen.

Für einen abweichenden App-Pfad kann weiterhin `AGENT_WORKSPACE_EXECUTABLE` gesetzt werden. Headless-Linux-Tests laufen mit Xvfb:

```sh
xvfb-run --auto-servernum --server-args="-screen 0 1600x1000x24" npm run test:packaged
```

Die CI setzt für diesen Test `AGENT_WORKSPACE_SMOKE_NO_SANDBOX=1`, weil der Linux-Runner keine passenden Chromium-Sandbox-Rechte bietet. Diese Einstellung betrifft nur den Teststart.

## GitHub Actions und Downloads

Die [Desktop-Pipeline](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml) läuft bei Pushes nach `main`, Pull Requests, Versions-Tags und manuellen Starts. Sie baut nativ auf vier Runnern:

- macOS ARM64 (`macos-15`)
- macOS Intel (`macos-15-intel`)
- Windows x64 (`windows-2022`)
- Linux x64 (`ubuntu-24.04`)

Jeder Job installiert mit `npm ci`, prüft Formatierung und Integrationstests, baut die Installer und startet anschließend die **gepackte Anwendung** im Desktop-Smoke-Test. Danach werden die Turnkey-Skripte einschließlich echter Installation und Start der installierten App geprüft. Linux führt zusätzlich den SSH-End-to-End-Test aus. Installer werden nur nach erfolgreichen Tests als `installers-*`-Artefakte hochgeladen; Screenshots und Logs liegen unter `diagnostics-*`. Artefakte bleiben sieben Tage verfügbar.

Ein Tag wie `v0.2.0`, der zur Version in `package.json` passt, veröffentlicht nach erfolgreichem Abschluss aller vier Builds automatisch ein [GitHub-Release](https://github.com/sd-softdev/ai-worktrees/releases) mit den Paketen, `install.sh`, `install.ps1` und `SHA256SUMS`. Normale Branch-Builds erzeugen Workflow-Artefakte.

## Struktur

```text
src/main/       Git, Dateisystem, PTY-Prozesse, Persistenz, Electron-Lebenszyklus
src/preload/    Typisierte, begrenzte IPC-Schnittstelle
src/shared/     Gemeinsame Typen und Terminal-Layout-Modell
src/renderer/   React-Oberfläche und xterm.js
src/remote/     Gebündelter Node.js-Helper für SSH-Hosts
tests/          Git-, Dateisystem- und Layout-Integrationstests
scripts/        Build-, Desktop-, SSH- und Installationstests
```

Setup-Automation, Port-/Datenbank-Isolation und Agenten-spezifische Statusintegrationen folgen später.
