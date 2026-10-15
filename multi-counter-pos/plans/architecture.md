
Build a Professional Multi-Counter POS with Go, Wails v3 and Portable PostgreSQL
We will build a complete desktop POS system with a central portable PostgreSQL database, multiple counters, one-click backup, and easy restoration. The goal is to let you install the server on one shop computer, install the POS on other computers, and manage everything from a desktop interface.

The most important design decision is to make backup and recovery a built-in feature—not something you must do manually by finding database files.

1. Final system architecture
Central Server PC
Runs continuously during business hours

Portable PostgreSQL

One shared database

Go API Server

Sales, stock, users and reports

Backup manager · Restore manager · Health monitor

Local network (LAN)

Counter 1

Wails + React

Counter 2

Wails + React

Counter 3

Wails + React

All counters communicate with the Go API. PostgreSQL is accessible only to the server-side application and authorized administrators.

2. The backup system we will build
One-click backup

The administrator clicks Create Backup. The server uses PostgreSQL's pg_dump utility to create a consistent database backup, calculates a checksum, records the result, and optionally packages the backup with a manifest into a ZIP archive.

Automatic scheduled backups

Configure daily backups, retention rules, and a separate backup destination such as an external USB drive or network storage.

Easy migration

Copy the backup ZIP to another compatible server installation and use the Restore Wizard to recover the database.

Safe restoration

Verify the archive, check PostgreSQL compatibility, protect existing data, restore to the intended database, and run validation checks before returning the POS to service.

Important: We will not ZIP a live PostgreSQL data directory and assume it is safe. Routine backups will use PostgreSQL's backup tools. A full-folder portable backup will be an additional option that requires a clean server shutdown.

3. Production-ready project structure
We will separate the desktop application, server, portable PostgreSQL runtime, and backup management so each component is easier to maintain.

easy-pos/
├── apps/
│   ├── desktop/                  # Wails v3 + React + TypeScript
│   │   ├── frontend/
│   │   │   ├── src/
│   │   │   │   ├── pages/
│   │   │   │   ├── components/
│   │   │   │   ├── services/
│   │   │   │   └── stores/
│   │   │   └── package.json
│   │   └── main.go
│   │
│   └── server/                   # Go REST API
│       └── main.go
│
├── internal/
│   ├── config/
│   ├── database/
│   ├── servermanager/
│   ├── backup/
│   ├── restore/
│   ├── auth/
│   ├── products/
│   ├── inventory/
│   ├── sales/
│   ├── counters/
│   └── audit/
│
├── migrations/
├── packaging/
│   ├── windows/
│   └── linux/
├── tests/
├── go.mod
└── README.md
The installed server directory will look like this:

EasyPOS-Server/
├── EasyPOS-Server.exe
├── runtime/
│   └── postgres/
├── data/
│   └── postgres/
├── config/
│   └── server.yaml
├── backups/
│   ├── automatic/
│   └── manual/
├── logs/
└── restore-temp/
Linux will have its own executable and PostgreSQL runtime. Windows binaries cannot be reused on Linux.

4. Desktop screens to implement
Supershop POS System — Portfolio

Dashboard

Today's sales, active counters, stock alerts, database status and last successful backup.

PT Digital Decision Indonesia — Partner Odoo Riau & Software House Pekanbaru

POS checkout

Barcode scanning, cart, discounts, tax, payment, receipt printing and cashier tracking.

How to restore from a backup? - Backup4all

Backup & Restore Center

Create backup, choose destination, configure schedules, inspect backup history and restore from ZIP.

5. Development roadmap
We will build the actual project step by step, with code and testing instructions for every stage.

Part

Deliverable

1

Project foundation and configuration

2

Portable PostgreSQL packaging and server lifecycle

3

Go API, database connection pool and migrations

4

Multi-counter database schema and transaction-safe sales

5

Authentication, cashier accounts and permissions

6

Wails v3 + React desktop interface

7

One-click PostgreSQL backup and ZIP export

8

Restore wizard, validation and recovery testing

9

Automatic backups, retention and external-drive copies

10

Windows and Linux installers

11

LAN discovery, server connection and counter setup

12

Production testing, upgrades, security and deployment

6. Three design decisions
One central database: all counters share the same PostgreSQL database through the Go API.

Portable deployment: PostgreSQL runtime, configuration, and data live in a managed installation directory, with platform-specific packages.

Reliable backups: routine backups use pg_dump; restoration is tested before the system declares a backup successful.

A portable folder makes migration easier, but it does not eliminate the need for separate backups. If the server disk fails, a backup stored only on that disk can be lost too.

We will begin with Part 1: the project foundation and server configuration, then implement the database lifecycle and backup manager before adding the POS checkout features.