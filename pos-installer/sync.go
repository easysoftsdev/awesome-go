package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type StoreInfo struct {
	WarehouseName string `json:"warehouse_name"`
	WarehouseLoc  string `json:"warehouse_location"`
	Counter       string `json:"counter"`
	Cashier       string `json:"cashier"`
	AppName       string `json:"app_name"`
	AppVersion    string `json:"app_version"`
	InstalledAt   string `json:"installed_at,omitempty"`
}

type OutboxPayload struct {
	Store StoreInfo `json:"store"`
	Sale  Sale      `json:"sale"`
}

type SyncStatus struct {
	Enabled     bool   `json:"enabled"`
	Configured  bool   `json:"configured"`
	ServerURL   string `json:"server_url"`
	Pending     int    `json:"pending"`
	Failed      int    `json:"failed"`
	LastAttempt string `json:"last_attempt"`
	LastSuccess string `json:"last_success"`
	LastError   string `json:"last_error"`
	InProgress  bool   `json:"in_progress"`
	LastResult  string `json:"last_result"`
}

type syncController struct {
	mu          sync.Mutex
	trigger     chan struct{}
	flushMu     sync.Mutex
	inProgress  bool
	lastAttempt string
	lastSuccess string
	lastError   string
	lastResult  string
}

var syncCtl = &syncController{trigger: make(chan struct{}, 1)}
var appInstance *application.App

const (
	syncInterval  = 60 * time.Second
	syncBatchSize = 100
)

func contextFromConfig() SaleContext {
	cfg, err := currentConfig()
	if err != nil {
		return SaleContext{
			Counter:    "Counter",
			Cashier:    "Operator",
			AppVersion: appVersion,
		}
	}
	ctx := SaleContext{
		WarehouseName: cfg.WarehouseName,
		WarehouseLoc:  cfg.WarehouseLoc,
		Counter:       cfg.CounterName,
		Cashier:       cfg.CashierName,
		AppVersion:    appVersion,
	}
	if ctx.Counter == "" {
		ctx.Counter = "Counter"
	}
	if ctx.Cashier == "" {
		ctx.Cashier = "Operator"
	}
	return ctx
}

func marshalOutboxPayload(ctx SaleContext, sale Sale) (string, error) {
	if ctx.WarehouseName == "" && ctx.Counter == "" {
		ctx = contextFromConfig()
	}
	payload := OutboxPayload{Store: ctxToStoreInfo(ctx), Sale: sale}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func ctxToStoreInfo(ctx SaleContext) StoreInfo {
	return StoreInfo{
		WarehouseName: ctx.WarehouseName,
		WarehouseLoc:  ctx.WarehouseLoc,
		Counter:       ctx.Counter,
		Cashier:       ctx.Cashier,
		AppName:       "Offline POS",
		AppVersion:    ctx.AppVersion,
	}
}

func resetSyncState() {
	syncCtl.mu.Lock()
	syncCtl.lastAttempt = ""
	syncCtl.lastSuccess = ""
	syncCtl.lastError = ""
	syncCtl.lastResult = ""
	syncCtl.mu.Unlock()
	for {
		select {
		case <-syncCtl.trigger:
		default:
			return
		}
	}
}

func startSyncLoop() {
	ticker := time.NewTicker(syncInterval)
	defer ticker.Stop()
	var ctxDone <-chan struct{}
	if appInstance != nil {
		ctxDone = appInstance.Context().Done()
	}
	for {
		select {
		case <-ticker.C:
		case <-syncCtl.trigger:
		case <-ctxDone:
			return
		}
		flushOutbox(false)
	}
}

func getSyncStatus() SyncStatus {
	syncCtl.mu.Lock()
	status := SyncStatus{
		LastAttempt: syncCtl.lastAttempt,
		LastSuccess: syncCtl.lastSuccess,
		LastError:   syncCtl.lastError,
		LastResult:  syncCtl.lastResult,
		InProgress:  syncCtl.inProgress,
	}
	syncCtl.mu.Unlock()

	cfg, err := currentConfig()
	if err != nil {
		return status
	}
	status.Configured = true
	if strings.TrimSpace(cfg.ServerURL) != "" {
		status.Enabled = true
		status.ServerURL = strings.TrimRight(cfg.ServerURL, "/")
	}
	if store, err := openStoreIfNeeded(); err == nil {
		pending, failed, err := store.OutboxCounts()
		if err == nil {
			status.Pending = pending
			status.Failed = failed
		}
	}
	return status
}

func syncNow() SyncStatus {
	flushOutbox(true)
	return getSyncStatus()
}

func queueSyncRetry() {
	select {
	case syncCtl.trigger <- struct{}{}:
	default:
	}
}

func flushOutbox(queueIfBusy bool) {
	if !syncCtl.flushMu.TryLock() {
		if queueIfBusy {
			queueSyncRetry()
		}
		return
	}
	defer syncCtl.flushMu.Unlock()

	syncCtl.mu.Lock()
	if syncCtl.inProgress {
		syncCtl.mu.Unlock()
		if queueIfBusy {
			queueSyncRetry()
		}
		return
	}
	syncCtl.inProgress = true
	syncCtl.mu.Unlock()
	defer func() {
		syncCtl.mu.Lock()
		syncCtl.inProgress = false
		syncCtl.mu.Unlock()
		emitSyncStatus()
	}()

	finish := func(attempt, success, lastErr, result string) {
		syncCtl.mu.Lock()
		syncCtl.lastAttempt = attempt
		if success != "" {
			syncCtl.lastSuccess = success
		}
		syncCtl.lastError = lastErr
		syncCtl.lastResult = result
		syncCtl.mu.Unlock()
	}

	cfg, err := currentConfig()
	if err != nil || strings.TrimSpace(cfg.ServerURL) == "" {
		finish("", "", "", "No sync server configured — data stays on this device")
		return
	}
	store, err := openStoreIfNeeded()
	if err != nil {
		finish(nowISO(), "", err.Error(), "Local database unavailable")
		return
	}
	rows, err := store.PendingOutbox(syncBatchSize)
	if err != nil {
		finish(nowISO(), "", err.Error(), "Could not read pending sales")
		return
	}
	if len(rows) == 0 {
		finish(nowISO(), nowISO(), "", "All sales are synced")
		return
	}

	client := &http.Client{Timeout: 15 * time.Second}
	endpoint := strings.TrimRight(cfg.ServerURL, "/") + "/api/sales"
	attemptAt := nowISO()
	sent, failed := 0, 0
	lastErr := ""

	for _, row := range rows {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, endpoint, bytes.NewBufferString(row.Payload))
		if err != nil {
			finish(attemptAt, "", err.Error(), "Could not build sync request")
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "OfflinePOS/"+appVersion)
		if cfg.ServerToken != "" {
			req.Header.Set("Authorization", "Bearer "+cfg.ServerToken)
		}

		resp, err := client.Do(req)
		if err != nil {
			failed++
			lastErr = err.Error()
			store.MarkOutboxAttempt(row.ID, lastErr)
			break
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			if err := store.MarkOutboxSent(row.ID); err != nil {
				failed++
				lastErr = err.Error()
			} else {
				sent++
			}
			continue
		}

		failed++
		lastErr = fmt.Sprintf("server replied %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		store.MarkOutboxAttempt(row.ID, lastErr)
		if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
			break
		}
	}

	result := fmt.Sprintf("%d sale(s) synced, %d failed", sent, failed)
	if failed == 0 {
		finish(attemptAt, attemptAt, "", result)
		return
	}
	finish(attemptAt, "", lastErr, result)
}

func emitSyncStatus() {
	if appInstance == nil {
		return
	}
	data, err := json.Marshal(getSyncStatus())
	if err != nil {
		return
	}
	appInstance.Event.Emit("sync:status", string(data))
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
