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

## Build & run

```bash
wails3 build          # → bin/pos-installer (embeds frontend/dist)
wails3 dev            # hot reload during development
./bin/pos-installer
```

Tests:

```bash
go test ./...
```

After changing Go service APIs regenerate the frontend bindings:

```bash
wails3 generate bindings -clean=true -ts -i
```

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
