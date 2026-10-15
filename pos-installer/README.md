# Offline POS

Offline-first point of sale built with **Wails v3**, **React + TypeScript** and embedded **SQLite**.
A first-run setup wizard prepares the device (folders, database, seeded catalog, config), then the
app opens straight into the till. Everything works without internet; sales can be queued and pushed
to a central server later.

## Features

- **Setup wizard** (6 steps): welcome, store profile, counter/currency, optional sync server,
  optional external DB mirror, review & install — with per-step validation and an install progress
  report.
- **Sale screen**: search/filter product grid, cart with quantity steppers, discount, cash/card/mobile
  payment with change calculation, printable receipt.
- **Sales history**: filter by range, search receipts, view detail, **void** a sale (restores stock)
  while it is still unsynced.
- **Products**: catalog table, low-stock filter, archived toggle, create/edit, stock adjustments,
  archive.
- **Reports**: today's revenue/transactions/basket/profit KPIs, 7-day revenue chart, top products,
  low-stock alerts.
- **Settings**: store profile, server & sync (manual sync, queue counters), data file paths,
  re-run wizard / factory reset.
- **Sync**: outbox table; queued sales are POSTed to `<server_url>/api/sales` with a Bearer token
  (60s loop + manual "Sync now"); status pill and per-receipt sync state.

## Stack

| Layer    | Tech                                             |
| -------- | ------------------------------------------------ |
| Shell    | Wails v3 (Go, webkit2gtk on Linux)               |
| Backend  | Go services `SetupService`, `PosService`, SQLite (modernc, WAL) |
| Frontend | React 19 + TypeScript + Vite, hand-rolled CSS    |
| Bindings | Generated TS clients in `frontend/bindings/`     |

Money is handled as integer cents end to end; stock is fractional (`REAL`) so weighed goods work.

## Requirements

- Go (toolchain auto-download, `go 1.25` in go.mod), Node 18+, npm
- [wails3 CLI](https://v3.wails.io) and [Task](https://taskfile.dev)
- Linux desktop: `webkit2gtk-4.1`, GTK3 dev packages, a C compiler
- For installers: `nsis` (Windows installer), Docker (Linux → Windows cross-compile)

```bash
# one-time tool setup
go install github.com/wailsapp/wails/v3/cmd/wails3@latest
sudo apt install nsis            # Windows installer generation
# wails3 task setup:docker       # once, ~800 MB image, for GOOS=windows packaging
```

---

## Start-to-end: build, test, package

Copy-paste block first, step-by-step notes below it:

```bash
# 1. Clean env (fixes WebKit/GTK crashes from Snap-provided libraries)
unset GTK_PATH GIO_MODULE_DIR LD_LIBRARY_PATH

# 2. Regenerate bindings
wails3 generate bindings -clean=true -ts -i

# 3. Build native Linux binary
wails3 build

# 4. Test it
./bin/pos-installer &

# 5. Create the Ubuntu installer
wails3 package GOOS=linux

# 6. Create the Windows installer (requires Docker)
wails3 package GOOS=windows

# 7. List all outputs
ls -lh bin/
```

### Step 1 — Clean the environment

If `GTK_PATH`, `GIO_MODULE_DIR` or `LD_LIBRARY_PATH` point into a Snap/conda toolchain, WebKitGTK
loads mismatched libraries and the app crashes on launch. Clear them in every shell you build or
run from:

```bash
unset GTK_PATH GIO_MODULE_DIR LD_LIBRARY_PATH
```

### Step 2 — Install frontend deps & regenerate bindings

```bash
cd frontend && npm install && cd ..
wails3 generate bindings -clean=true -ts -i
```

Bindings land in `frontend/bindings/pos-installer/` (`index.ts`, `models.ts`, `setupservice.ts`,
`posservice.ts`). Regenerate after any change to the Go service APIs.

### Step 3 — Build

```bash
wails3 build
```

Pipeline: tidy → frontend `tsc && vite build` → bindings → icons → `go build` (embeds
`frontend/dist`). Output: `bin/pos-installer`.

Unit tests:

```bash
go test ./...
```

### Step 4 — Test the binary

```bash
./bin/pos-installer &
```

First launch shows the setup wizard; after install the app opens straight into the till.

### Step 5 — Ubuntu package

```bash
wails3 package GOOS=linux
```

Produces in `bin/`:

- `pos-installer.deb` — standard Debian/Ubuntu installer
- `pos-installer-x86_64.AppImage` — portable, no-install version
- `pos-installer.rpm` — Fedora/RHEL
- `pos-installer.pkg.tar.zst` — Arch Linux

Install on a user machine:

```bash
sudo dpkg -i pos-installer.deb
```

or double-click the `.deb` in Files → Software Center → Install.

### Step 6 — Windows package (cross-compile via Docker)

Needs Docker running and the Wails cross-compile image (one-time `wails3 task setup:docker`), plus
NSIS for the installer.

```bash
wails3 package GOOS=windows
```

Produces:

- `bin/pos-installer.exe` — raw executable
- `bin/pos-installer-amd64-installer.exe` — NSIS installer (send this one)

The installer registers the app in `C:\Program Files\`, Start Menu, optional desktop shortcut and
Add/Remove Programs.

### Step 7 — List all outputs

```bash
ls -lh bin/
```

| File                                | Platform | Purpose                       |
| ----------------------------------- | -------- | ----------------------------- |
| `pos-installer`                     | Linux    | Raw binary (for testing)      |
| `pos-installer.deb`                 | Ubuntu   | Installer for Ubuntu users    |
| `pos-installer-x86_64.AppImage`     | Linux    | Portable, no-install version  |
| `pos-installer.rpm`                 | Fedora   | RPM package                   |
| `pos-installer.pkg.tar.zst`         | Arch     | Arch package                  |
| `pos-installer-amd64-installer.exe` | Windows  | Installer for Windows users   |

### Distribution

- **Windows** → send `pos-installer-amd64-installer.exe`; double-click installs, Start Menu entry
  opens the setup wizard.
- **Ubuntu** → send `pos-installer.deb`; Software Center installs, app grid opens the wizard.

After the wizard runs once, config is saved to:

- Linux: `~/.config/pos-installer/config.json`
- Windows: `%APPDATA%\pos-installer\config.json`

Every later launch skips the wizard and opens the POS.

---

## Development mode

```bash
unset GTK_PATH GIO_MODULE_DIR LD_LIBRARY_PATH
wails3 dev -port 3000
```

Hot reload for Go and frontend changes.

## Data & config

Per-user config directory (XDG, e.g. `~/.config/pos-installer/`):

- `config.json` — store profile + sync settings, written `0600` (owner-only; may hold tokens)
- `pos.db` — SQLite database (products, sales, sale_items, stock_moves, outbox), WAL mode

The catalog is seeded with 38 everyday products on install (and on warmup if the catalog is empty).
"Factory reset" in Settings deletes both files and restarts the wizard.

## Project layout

- `main.go` — app bootstrap, window, services, sync loop start
- `setupservice.go` — wizard API: `IsConfigured`, `Install`, `GetConfig`, `UpdateConfig`,
  `ResetConfig`, `FactoryReset`, `GetSystemInfo`
- `posservice.go` — till API: products, checkout, sales/void, dashboard, sync status/now
- `store.go` — SQLite schema, queries, seed catalog
- `sync.go` — outbox flush, status events (`sync:status`)
- `store_test.go` — unit tests for seed, search/filters, checkout math, void, dashboard
- `frontend/src/` — `wizard/`, `pos/` (Sale, Products, Sales, Reports, Settings), components, styles
- `build/config.yml` — packaging metadata (company/product names, version)

## Troubleshooting

| Error                                         | Fix                                                        |
| --------------------------------------------- | ---------------------------------------------------------- |
| WebKit crash / blank window on Ubuntu         | `unset GTK_PATH GIO_MODULE_DIR LD_LIBRARY_PATH`            |
| `Cannot find module '../bindings/...'`        | `wails3 generate bindings -clean=true -ts -i`              |
| `Missing index.html`                          | Ensure `//go:embed all:frontend/dist` in main.go; `npm run build` |
| `failed to build frontend`                    | `cd frontend && npm install` first                         |
| `NSIS not found`                              | `sudo apt install nsis`                                    |
| Docker permission denied                      | `sudo usermod -aG docker $USER`, re-login                  |
| TypeScript errors                             | Fix `frontend/src/*.tsx` — build stops until TS is clean   |
