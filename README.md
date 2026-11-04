# Agent Workspace

[![Desktop builds](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml/badge.svg)](https://github.com/sd-softdev/ai-worktrees/actions/workflows/build.yml)

Ein lokaler Desktop-Workspace für parallele Entwicklung mit Git Worktrees. Gebaut mit Electron, TypeScript und React für macOS, Windows und Linux.

## Starten

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

Terminals starten im jeweiligen Worktree. Dort lassen sich reguläre CLI-Programme wie `opencode`, Build-Kommandos und Entwicklungsserver starten. Ein Klick auf das Schließen-Symbol beendet den zugehörigen Terminalprozess.

Git-Status und Dateibaum werden alle fünf Sekunden und beim Aktivieren des Fensters aktualisiert. Große Vorschauen sind begrenzt, der Terminal-Scrollback umfasst 8.000 Zeilen.

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
```

- Integrationstests verwenden temporäre echte Git-Repositories.
- Der plattformübergreifende Desktop-Smoke-Test startet Electron und prüft echte PTYs, eine Vollbild-TUI, große Terminalausgabe, Worktree-Isolation, Splits, Diffs, Dateibaum, Session-Wechsel und Layout-Wiederherstellung. Er benötigt eine Desktop-Sitzung und erzeugt Screenshots und Diagnoselogs unter `artifacts/`.
- `pack` erzeugt ein App-Verzeichnis unter `dist/`. `test:packaged` findet dessen ausführbare Datei automatisch auf der aktuellen Plattform.
- Die Distributionsbefehle werden auf dem jeweiligen Zielbetriebssystem ausgeführt, damit auch `node-pty` für dieses System gebaut und getestet wird.
- macOS- und Windows-Builds sind derzeit unsigniert; macOS ist nicht notarisiert.
- `node-pty` wird beim Installieren für die Electron-Version gebaut. Nach einem Electron-Update bei Bedarf `npm run postinstall` ausführen.

| Befehl               | Ziel                        | Paket                   |
| -------------------- | --------------------------- | ----------------------- |
| `npm run dist:mac`   | macOS, aktuelle Architektur | `.dmg`                  |
| `npm run dist:win`   | Windows x64                 | `.exe` (NSIS-Installer) |
| `npm run dist:linux` | Linux x64                   | `.AppImage`, `.deb`     |

Beispiel: `dist/agent-workspace-0.1.0-linux-x64.AppImage`. Unter Linux kann für AppImages zusätzlich FUSE 2 erforderlich sein (`libfuse2t64` auf Ubuntu 24.04). Das AppImage vor dem Start ausführbar machen.

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

Jeder Job installiert mit `npm ci`, prüft Formatierung und Integrationstests, baut die Installer und startet anschließend die **gepackte Anwendung** im Desktop-Smoke-Test. Installer werden nur nach erfolgreichem Test als `installers-*`-Artefakte hochgeladen; Screenshots und Logs liegen unter `diagnostics-*`. Artefakte bleiben sieben Tage verfügbar.

Ein Tag wie `v0.1.0`, der zur Version in `package.json` passt, veröffentlicht nach erfolgreichem Abschluss aller vier Builds automatisch eine [GitHub Release](https://github.com/sd-softdev/ai-worktrees/releases) mit den Installern. Normale Branch-Builds erzeugen Workflow-Artefakte.

## Struktur

```text
src/main/       Git, Dateisystem, PTY-Prozesse, Persistenz, Electron-Lebenszyklus
src/preload/    Typisierte, begrenzte IPC-Schnittstelle
src/shared/     Gemeinsame Typen und Terminal-Layout-Modell
src/renderer/   React-Oberfläche und xterm.js
tests/          Git-, Dateisystem- und Layout-Integrationstests
scripts/        Electron-Smoke-Test
```

Setup-Automation, Port-/Datenbank-Isolation und Agenten-spezifische Statusintegrationen folgen später.
