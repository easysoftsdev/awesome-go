import { useCallback, useEffect, useMemo, useState } from "react";
import { Events } from "@wailsio/runtime";
import { PosService, SetupService, type Config, type SyncStatus } from "../../bindings/pos-installer";
import { Icon, type IconName } from "../components/Icon";
import { AppCtx, type ViewKey } from "./context";
import SaleView from "./SaleView";
import ProductsView from "./ProductsView";
import SalesView from "./SalesView";
import ReportsView from "./ReportsView";
import SettingsView from "./SettingsView";
import { errorMessage, initials } from "../lib/format";
import { toastError, toastSuccess } from "../lib/toast";

const NAV: Array<{ key: ViewKey; label: string; icon: IconName }> = [
  { key: "sale", label: "Sale", icon: "cart" },
  { key: "products", label: "Products", icon: "box" },
  { key: "sales", label: "Sales", icon: "receipt" },
  { key: "reports", label: "Reports", icon: "chart" },
  { key: "settings", label: "Settings", icon: "settings" },
];

const TITLES: Record<ViewKey, { title: string; sub: string }> = {
  sale: { title: "New sale", sub: "Tap products to build the cart" },
  products: { title: "Products", sub: "Catalog, prices and stock levels" },
  sales: { title: "Sales history", sub: "Receipts, refunds and sync state" },
  reports: { title: "Reports", sub: "Today at a glance and the last 7 days" },
  settings: { title: "Settings", sub: "Store profile, sync and data" },
};

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="clock" title={now.toLocaleDateString()}>
      <Icon name="clock" size={14} />
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </div>
  );
}

export default function PosApp({ onWizardReset }: { onWizardReset: () => void }) {
  const [view, setView] = useState<ViewKey>("sale");
  const [config, setConfig] = useState<Config | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);

  const refreshConfig = useCallback(async () => {
    try {
      setConfig(await SetupService.GetConfig());
    } catch (err) {
      toastError(errorMessage(err));
    }
  }, []);

  const refreshSync = useCallback(async () => {
    try {
      setSync(await PosService.GetSyncStatus());
    } catch {
      // sync status is non-critical; keep the previous value
    }
  }, []);

  useEffect(() => {
    refreshConfig();
    refreshSync();
    const off = Events.On("sync:status", (ev) => {
      try {
        setSync(JSON.parse(String(ev.data)) as SyncStatus);
      } catch {
        refreshSync();
      }
    });
    return off;
  }, [refreshConfig, refreshSync]);

  const runSyncNow = useCallback(async () => {
    try {
      const status = await PosService.SyncNow();
      setSync(status);
      if (!status.enabled) {
        toastSuccess("No sync server configured — data stays on this device");
      } else if (status.pending === 0) {
        toastSuccess("Everything is synced");
      } else if (status.failed > 0) {
        toastError(status.last_error || `${status.failed} sale(s) could not be synced`);
      } else {
        toastSuccess(`${status.pending} sale(s) still waiting for the server`);
      }
    } catch (err) {
      toastError(errorMessage(err));
    }
  }, []);

  const ctx = useMemo(
    () => ({
      config: config as Config,
      sync: sync as SyncStatus,
      refreshConfig,
      refreshSync,
      runSyncNow,
      onWizardReset,
      goto: (v: ViewKey) => setView(v),
    }),
    [config, sync, refreshConfig, refreshSync, runSyncNow, onWizardReset],
  );

  if (!config || !sync) {
    return (
      <div className="loading-screen">
        <img src="/logo.svg" alt="" className="ls-logo" />
        <div className="ls-text">Loading your workspace…</div>
        <div className="spinner dark" />
      </div>
    );
  }

  const pillState = sync.in_progress
    ? "busy"
    : sync.last_error && sync.failed > 0
      ? "error"
      : !sync.enabled
        ? "off"
        : sync.pending > 0
          ? "pending"
          : "synced";

  const pillTitle =
    pillState === "busy"
      ? "Syncing…"
      : pillState === "error"
        ? `${sync.failed} failed`
        : pillState === "off"
          ? "Local only"
          : pillState === "pending"
            ? `${sync.pending} waiting`
            : "All synced";

  const pillSub = sync.enabled
    ? (sync.last_result || sync.server_url)
    : "no server configured";

  const heading = TITLES[view];

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app-shell">
        <aside className="sidebar app-no-print">
          <div className="side-brand">
            <img src="/logo.svg" alt="" />
            <div className="brand-text">
              <div className="brand-title">Offline POS</div>
              <div className="brand-sub">{config.warehouse_name || "Setup incomplete"}</div>
            </div>
          </div>

          <nav className="side-nav">
            {NAV.map((item) => (
              <button
                key={item.key}
                className={`nav-item ${view === item.key ? "active" : ""}`}
                onClick={() => setView(item.key)}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="side-foot">
            <button
              className={`sync-pill ${pillState}`}
              onClick={runSyncNow}
              title={sync.last_error || sync.server_url || "Local-only mode"}
            >
              <span className="sp-dot" />
              <span className="sp-text">
                <span className="sp-title">{pillTitle}</span>
                <span className="sp-sub">{pillSub}</span>
              </span>
            </button>
            <div className="user-chip">
              <span className="avatar">{initials(config.cashier_name || "Operator")}</span>
              <span className="u-text">
                <div className="u-name">{config.cashier_name || "Operator"}</div>
                <div className="u-role">{config.counter_name || "Counter"}</div>
              </span>
            </div>
          </div>
        </aside>

        <div className="main-column">
          <header className="topbar app-no-print">
            <div>
              <div className="tb-title">{heading.title}</div>
              <div className="tb-sub">{heading.sub}</div>
            </div>
            <div className="tb-right">
              <Clock />
            </div>
          </header>

          {view === "sale" && <SaleView key="sale" />}
          {view === "products" && <ProductsView key="products" />}
          {view === "sales" && <SalesView key="sales" />}
          {view === "reports" && <ReportsView key="reports" />}
          {view === "settings" && <SettingsView key="settings" />}
        </div>
      </div>
    </AppCtx.Provider>
  );
}
