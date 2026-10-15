package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
)

const (
	appFolderName = "pos-installer"
	configFileName = "config.json"
	dbFileName     = "pos.db"
)

// Config holds every setting collected by the Setup Wizard.
// JSON names are snake_case so the generated TS bindings match the plan.
type Config struct {
	WarehouseName string `json:"warehouse_name"`
	WarehouseLoc  string `json:"warehouse_location"`
	CounterName   string `json:"counter_name"`
	CashierName   string `json:"cashier_name"`
	Currency      string `json:"currency"`
	ServerURL     string `json:"server_url"`
	ServerToken   string `json:"server_token"`
	DBHost        string `json:"db_host"`
	DBName        string `json:"db_name"`
	DBUser        string `json:"db_user"`
	DBPass        string `json:"db_pass"`
	IsConfigured  bool   `json:"is_configured"`
}

// SysInfo is shown on the wizard welcome screen so the operator can see
// where the application is going to install its data.
type SysInfo struct {
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	Version     string `json:"version"`
	ConfigDir   string `json:"config_dir"`
	DataFile    string `json:"data_file"`
	ConfigFile  string `json:"config_file"`
	ProductName string `json:"product_name"`
}

// InstallStep is one line of the install progress report.
type InstallStep struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
	OK     bool   `json:"ok"`
}

// InstallResult is returned by Install() and drives the wizard's progress UI.
type InstallResult struct {
	OK       bool              `json:"ok"`
	Message  string            `json:"message"`
	Errors   map[string]string `json:"errors"`
	Steps    []InstallStep     `json:"steps"`
	ConfigDir string           `json:"config_dir"`
	DataFile  string           `json:"data_file"`
}

// appState shares the open database handle between services.
type appState struct {
	mu    sync.Mutex
	store *Store
}

var state = &appState{}

func appDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve user config dir: %w", err)
	}
	return filepath.Join(base, appFolderName), nil
}

func configFilePath() (string, error) {
	dir, err := appDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, configFileName), nil
}

func dbFilePath() (string, error) {
	dir, err := appDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, dbFileName), nil
}

// currentConfig reads the saved configuration, if any.
func currentConfig() (Config, error) {
	var cfg Config
	path, err := configFilePath()
	if err != nil {
		return cfg, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("config is corrupt: %w", err)
	}
	return cfg, nil
}

// openStoreIfNeeded opens (and idempotently prepares) the embedded local database.
func openStoreIfNeeded() (*Store, error) {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.store != nil {
		return state.store, nil
	}
	path, err := dbFilePath()
	if err != nil {
		return nil, err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("cannot create data directory: %w", err)
	}
	store, err := openStore(path)
	if err != nil {
		return nil, err
	}
	if err := store.Init(); err != nil {
		store.Close()
		return nil, err
	}
	state.store = store
	return store, nil
}

// validateConfig returns field -> human readable error. Empty map means valid.
func validateConfig(cfg Config) map[string]string {
	errs := map[string]string{}

	if v := strings.TrimSpace(cfg.WarehouseName); v == "" {
		errs["warehouse_name"] = "Warehouse name is required"
	} else if len(v) > 60 {
		errs["warehouse_name"] = "Keep it under 60 characters"
	}
	if v := strings.TrimSpace(cfg.WarehouseLoc); v == "" {
		errs["warehouse_location"] = "Location is required"
	} else if len(v) > 80 {
		errs["warehouse_location"] = "Keep it under 80 characters"
	}
	if v := strings.TrimSpace(cfg.CounterName); v == "" {
		errs["counter_name"] = "Counter name is required"
	} else if len(v) > 40 {
		errs["counter_name"] = "Keep it under 40 characters"
	}
	if len(cfg.CashierName) > 40 {
		errs["cashier_name"] = "Keep it under 40 characters"
	}
	if v := strings.TrimSpace(cfg.Currency); v != "" {
		if len(v) != 3 || strings.ToLower(v) == strings.ToUpper(v) {
			errs["currency"] = "Use a 3-letter currency code, e.g. USD"
		}
	}

	if v := strings.TrimSpace(cfg.ServerURL); v != "" {
		u, err := url.Parse(v)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errs["server_url"] = "Enter a full URL, e.g. https://api.example.com"
		}
	}
	if len(cfg.ServerToken) > 256 {
		errs["server_token"] = "Token is too long"
	}

	// The local database is embedded, so these fields are only needed when the
	// operator wants to mirror sales to an external SQL server.
	if strings.TrimSpace(cfg.DBHost) != "" {
		if strings.TrimSpace(cfg.DBName) == "" {
			errs["db_name"] = "Database name is required when a host is set"
		}
		if strings.TrimSpace(cfg.DBUser) == "" {
			errs["db_user"] = "Database user is required when a host is set"
		}
	} else if strings.TrimSpace(cfg.DBName) != "" {
		errs["db_host"] = "Add a host, or clear the database fields"
	}

	return errs
}

// SetupService is the Go service exposed to the wizard frontend.
type SetupService struct{}

// IsConfigured reports whether the wizard has completed before.
func (s *SetupService) IsConfigured() bool {
	path, err := configFilePath()
	if err != nil {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// GetSystemInfo returns install paths and platform details for step 1.
func (s *SetupService) GetSystemInfo() SysInfo {
	dir, _ := appDir()
	cfgPath, _ := configFilePath()
	dbPath, _ := dbFilePath()
	return SysInfo{
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
		Version:     appVersion,
		ConfigDir:   dir,
		ConfigFile:  cfgPath,
		DataFile:    dbPath,
		ProductName: "Offline POS",
	}
}

// GetConfig reads the saved configuration back into the UI.
func (s *SetupService) GetConfig() (Config, error) {
	return currentConfig()
}

// Install runs the real installation: folders, embedded database, seed catalog
// and the config file. Every step is reported back to the wizard.
func (s *SetupService) Install(cfg Config) InstallResult {
	cfg.WarehouseName = strings.TrimSpace(cfg.WarehouseName)
	cfg.WarehouseLoc = strings.TrimSpace(cfg.WarehouseLoc)
	cfg.CounterName = strings.TrimSpace(cfg.CounterName)
	cfg.ServerURL = strings.TrimRight(strings.TrimSpace(cfg.ServerURL), "/")
	cfg.ServerToken = strings.TrimSpace(cfg.ServerToken)
	cfg.DBHost = strings.TrimSpace(cfg.DBHost)
	cfg.DBName = strings.TrimSpace(cfg.DBName)
	cfg.DBUser = strings.TrimSpace(cfg.DBUser)
	cfg.CashierName = strings.TrimSpace(cfg.CashierName)
	cfg.Currency = strings.ToUpper(strings.TrimSpace(cfg.Currency))
	if cfg.Currency == "" {
		cfg.Currency = "USD"
	}

	result := InstallResult{Errors: validateConfig(cfg), Steps: []InstallStep{}}
	dir, dirErr := appDir()
	if dirErr == nil {
		result.ConfigDir = dir
		result.DataFile = filepath.Join(dir, dbFileName)
	}
	add := func(title, detail string, err error) bool {
		step := InstallStep{Title: title, Detail: detail, OK: err == nil}
		if err != nil {
			step.Detail = err.Error()
			result.Message = title + " failed: " + err.Error()
		}
		result.Steps = append(result.Steps, step)
		return err == nil
	}

	// 1. Validate
	if len(result.Errors) > 0 {
		add("Validate settings", "Fix the highlighted fields", errors.New("validation failed"))
		result.Message = "Some settings need attention"
		return result
	}
	add("Validate settings", "Settings look good", nil)

	// 2. Folders
	if !add("Create folders", dir, os.MkdirAll(dir, 0o700)) {
		return result
	}

	// 3. Local database
	store, err := openStoreIfNeeded()
	if !add("Initialize local database", result.DataFile, err) {
		return result
	}

	// 4. Seed catalog
	seeded, err := store.EnsureSeedData()
	if !add("Seed product catalog", seeded, err) {
		return result
	}

	// 5. Configuration file
	cfg.IsConfigured = true
	if !add("Write configuration", filepath.Join(dir, configFileName), writeConfig(cfg)) {
		return result
	}

	// 6. Verify
	count, err := store.CountProducts()
	if err == nil && count == 0 {
		err = errors.New("product catalog is empty")
	}
	verifyDetail := fmt.Sprintf("%d products available offline", count)
	if !add("Verify installation", verifyDetail, err) {
		return result
	}

	// Fresh sync loop state so a re-install picks up the new server settings.
	resetSyncState()

	result.OK = true
	result.Message = "Installation complete"
	return result
}

// UpdateConfig saves edits made from the Settings screen and refreshes the
// sync loop so new server credentials take effect immediately.
func (s *SetupService) UpdateConfig(cfg Config) error {
	cfg.WarehouseName = strings.TrimSpace(cfg.WarehouseName)
	cfg.WarehouseLoc = strings.TrimSpace(cfg.WarehouseLoc)
	cfg.CounterName = strings.TrimSpace(cfg.CounterName)
	cfg.CashierName = strings.TrimSpace(cfg.CashierName)
	cfg.Currency = strings.ToUpper(strings.TrimSpace(cfg.Currency))
	cfg.ServerURL = strings.TrimRight(strings.TrimSpace(cfg.ServerURL), "/")
	cfg.ServerToken = strings.TrimSpace(cfg.ServerToken)
	cfg.DBHost = strings.TrimSpace(cfg.DBHost)
	cfg.DBName = strings.TrimSpace(cfg.DBName)
	cfg.DBUser = strings.TrimSpace(cfg.DBUser)

	if cfg.Currency == "" {
		cfg.Currency = "USD"
	}
	if errs := validateConfig(cfg); len(errs) > 0 {
		fields := make([]string, 0, len(errs))
		for field := range errs {
			fields = append(fields, field)
		}
		sort.Strings(fields)
		msgs := make([]string, 0, len(fields))
		for _, field := range fields {
			msgs = append(msgs, field+": "+errs[field])
		}
		return fmt.Errorf("%s", strings.Join(msgs, "; "))
	}
	cfg.IsConfigured = true
	if err := writeConfig(cfg); err != nil {
		return err
	}
	resetSyncState()
	return nil
}

// ResetConfig deletes only the configuration so the wizard runs again.
// Local sales data is kept.
func (s *SetupService) ResetConfig() error {
	path, err := configFilePath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("cannot remove config: %w", err)
	}
	return nil
}

// FactoryReset removes the configuration, the local database and the outbox.
func (s *SetupService) FactoryReset() error {
	if err := (&SetupService{}).ResetConfig(); err != nil {
		return err
	}
	state.mu.Lock()
	if state.store != nil {
		state.store.Close()
		state.store = nil
	}
	state.mu.Unlock()

	path, err := dbFilePath()
	if err != nil {
		return err
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.Remove(path + suffix); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("cannot remove database: %w", err)
		}
	}
	resetSyncState()
	return nil
}

// writeConfig writes the config atomically with owner-only permissions
// because it can contain tokens and database credentials.
func writeConfig(cfg Config) error {
	path, err := configFilePath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("cannot encode config: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("cannot write config: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("cannot commit config: %w", err)
	}
	return nil
}
