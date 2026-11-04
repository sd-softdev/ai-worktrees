# Agent Workspace

Ein lokaler Desktop-Workspace für parallele Entwicklung mit Git Worktrees. Gebaut mit Electron, TypeScript und React; zunächst für macOS.

## Starten

Voraussetzungen: Node.js 22.16+ (die konkrete Mindestversion wird durch die Build-Abhängigkeiten bestimmt), npm, Git und die Xcode Command Line Tools für native Abhängigkeiten. Entwickelt und geprüft mit Node.js 26 auf macOS ARM64.

```sh
npm install
npm run dev
```

Über **Workspace öffnen** ein ausgechecktes Git-Repository auswählen. Die App erkennt auch Worktrees außerhalb des Repository-Ordners. Neue Worktrees entstehen standardmäßig unter `.worktrees/`; dieser Ordner wird über die lokale Git-Exclude-Datei ignoriert.

## Funktionen

- Ein geöffneter Workspace mit Worktree-Übersicht und optionalen Aufgabenbeschreibungen.
- Worktrees mit eigenem Branch erstellen und kontrolliert entfernen. Beim Entfernen bleiben Branches und Commits erhalten.
- Echte Login-Shells über `node-pty` und `xterm.js`, mit Tabs und horizontalen/vertikalen Splits.
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
```

- Integrationstests verwenden temporäre echte Git-Repositories.
- Der Desktop-Smoke-Test startet Electron, prüft echte PTYs, Worktree-Isolation, Splits, Diffs, Dateibaum, Session-Wechsel und Layout-Wiederherstellung. Er benötigt eine Desktop-Sitzung und erzeugt Screenshots unter `artifacts/`.
- `pack` erzeugt eine lokale App unter `dist/`, `dist:mac` ein DMG für die aktuelle Architektur.
- Lokale macOS-Builds sind nicht für öffentliche Verteilung signiert oder notarisiert.
- `node-pty` wird beim Installieren für die Electron-Version gebaut. Nach einem Electron-Update bei Bedarf `npm run postinstall` ausführen.

Ein bereits gebautes App-Bundle kann mit demselben Smoke-Test geprüft werden:

```sh
AGENT_WORKSPACE_EXECUTABLE="$(pwd)/dist/mac-arm64/Agent Workspace.app/Contents/MacOS/Agent Workspace" node scripts/smoke.mjs
```

## Struktur

```text
src/main/       Git, Dateisystem, PTY-Prozesse, Persistenz, Electron-Lebenszyklus
src/preload/    Typisierte, begrenzte IPC-Schnittstelle
src/shared/     Gemeinsame Typen und Terminal-Layout-Modell
src/renderer/   React-Oberfläche und xterm.js
tests/          Git-, Dateisystem- und Layout-Integrationstests
scripts/        Electron-Smoke-Test
```

Linux- und Windows-Paketziele sind vorbereitet. Die plattformübergreifenden Git-, Pfad- und Terminal-Bausteine sind vorhanden; Tests, Distribution und Plattformdetails werden dort in einer späteren Etappe validiert. Setup-Automation, Port-/Datenbank-Isolation und Agenten-spezifische Statusintegrationen folgen ebenfalls später.
