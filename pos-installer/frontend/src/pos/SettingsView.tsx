import { useEffect, useState } from "react";
import { SetupService, type SysInfo } from "../../bindings/pos-installer";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { useApp } from "./context";
import { CURRENCY_CODES, errorMessage, relativeTime } from "../lib/format";
import { toastError, toastSuccess } from "../lib/toast";

export default function SettingsView() {
  const { config, sync, refreshConfig, runSyncNow, onWizardReset } = useApp();

  const [profile, setProfile] = useState(config);
  const [server, setServer] = useState(config);
  const [sysInfo, setSysInfo] = useState<SysInfo | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingServer, setSavingServer] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [factoryOpen, setFactoryOpen] = useState(false);
  const [factoryBusy, setFactoryBusy] = useState(false);

  useEffect(() => {
    setProfile(config);
    setServer(config);
  }, [config]);

  useEffect(() => {
    SetupService.GetSystemInfo()
      .then(setSysInfo)
      .catch(() => setSysInfo(null));
  }, []);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await SetupService.UpdateConfig({ ...config, ...profile });
      await refreshConfig();
      toastSuccess("Store profile saved");
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const saveServer = async () => {
    setSavingServer(true);
    try {
      await SetupService.UpdateConfig({ ...config, ...server });
      await refreshConfig();
      toastSuccess("Server settings saved");
      runSyncNow();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setSavingServer(false);
    }
  };

  const runFactoryReset = async () => {
    setFactoryBusy(true);
    try {
      await SetupService.FactoryReset();
      setFactoryOpen(false);
      onWizardReset();
    } catch (err) {
      toastError(errorMessage(err));
      setFactoryBusy(false);
    }
  };

  const runWizardReset = async () => {
    try {
      await SetupService.ResetConfig();
      onWizardReset();
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  const dirtyProfile =
    profile.warehouse_name !== config.warehouse_name ||
    profile.warehouse_location !== config.warehouse_location ||
    profile.counter_name !== config.counter_name ||
    profile.cashier_name !== config.cashier_name ||
    profile.currency !== config.currency;

  const dirtyServer = server.server_url !== config.server_url || server.server_token !== config.server_token;

  return (
    <div className="view-scroll">
      <div className="settings-grid">
        <div className="card settings-card">
          <div className="sc-head">
            <div className="card-title">
              <Icon name="store" size={16} />
              Store profile
            </div>
            <div className="card-sub">Shown on receipts and reports</div>
          </div>
          <div className="sc-body">
            <div className="field">
              <label>Warehouse name</label>
              <input
                className="input"
                value={profile.warehouse_name}
                onChange={(e) => setProfile({ ...profile, warehouse_name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Location</label>
              <input
                className="input"
                value={profile.warehouse_location}
                onChange={(e) => setProfile({ ...profile, warehouse_location: e.target.value })}
              />
            </div>
            <div className="form-row">
              <div className="field">
                <label>Counter name</label>
                <input
                  className="input"
                  value={profile.counter_name}
                  onChange={(e) => setProfile({ ...profile, counter_name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Cashier name</label>
                <input
                  className="input"
                  value={profile.cashier_name}
                  onChange={(e) => setProfile({ ...profile, cashier_name: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>Currency</label>
              <select
                className="select"
                value={profile.currency}
                onChange={(e) => setProfile({ ...profile, currency: e.target.value })}
              >
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="sc-foot">
            <button
              className="btn btn-outline"
              onClick={() => setProfile(config)}
              disabled={!dirtyProfile}
            >
              Discard
            </button>
            <button className="btn btn-primary" onClick={saveProfile} disabled={savingProfile || !dirtyProfile}>
              {savingProfile ? <span className="spinner" /> : <Icon name="check" size={15} />}
              Save profile
            </button>
          </div>
        </div>

        <div className="card settings-card">
          <div className="sc-head">
            <div className="card-title">
              <Icon name="server" size={16} />
              Server &amp; sync
            </div>
            <div className="card-sub">Push queued sales to a central API</div>
          </div>
          <div className="sc-body">
            <div className="field">
              <label>Server URL</label>
              <input
                className="input mono"
                placeholder="https://api.example.com"
                value={server.server_url}
                onChange={(e) => setServer({ ...server, server_url: e.target.value })}
              />
              <span className="hint">
                Sales are POSTed to <span className="mono">/api/sales</span> with a Bearer token.
              </span>
            </div>
            <div className="field">
              <label>API token</label>
              <div className="input-affix">
                <span className="affix-icon">
                  <Icon name="key" size={15} />
                </span>
                <input
                  className="input mono"
                  type={showToken ? "text" : "password"}
                  value={server.server_token}
                  onChange={(e) => setServer({ ...server, server_token: e.target.value })}
                  placeholder="Bearer token"
                  autoComplete="off"
                />
                <span className="affix-action">
                  <button className="btn btn-ghost btn-icon" onClick={() => setShowToken((v) => !v)}>
                    <Icon name={showToken ? "eyeOff" : "eye"} size={15} />
                  </button>
                </span>
              </div>
            </div>

            <div className="sync-summary">
              <div className="ss-row">
                <span className="k">Mode</span>
                <span className="v">{sync.enabled ? "Cloud sync enabled" : "Local only"}</span>
              </div>
              <div className="ss-row">
                <span className="k">Queued sales</span>
                <span className="v">{sync.pending}</span>
              </div>
              <div className="ss-row">
                <span className="k">Failed</span>
                <span className="v">{sync.failed}</span>
              </div>
              <div className="ss-row">
                <span className="k">Last attempt</span>
                <span className="v">{sync.last_attempt ? relativeTime(sync.last_attempt) : "never"}</span>
              </div>
              <div className="ss-row">
                <span className="k">Last success</span>
                <span className="v">{sync.last_success ? relativeTime(sync.last_success) : "—"}</span>
              </div>
              <div className="ss-row">
                <span className="k">Last result</span>
                <span className="v">{sync.last_result || "—"}</span>
              </div>
              {sync.last_error && (
                <div className="ss-row">
                  <span className="k">Error</span>
                  <span className="v err">{sync.last_error}</span>
                </div>
              )}
            </div>

            <button
              className="btn btn-outline btn-block"
              onClick={runSyncNow}
              disabled={sync.in_progress}
            >
              {sync.in_progress ? <span className="spinner dark" /> : <Icon name="sync" size={15} />}
              {sync.in_progress ? "Syncing…" : "Sync now"}
            </button>
          </div>
          <div className="sc-foot">
            <button
              className="btn btn-outline"
              onClick={() => setServer(config)}
              disabled={!dirtyServer}
            >
              Discard
            </button>
            <button className="btn btn-primary" onClick={saveServer} disabled={savingServer || !dirtyServer}>
              {savingServer ? <span className="spinner" /> : <Icon name="check" size={15} />}
              Save server
            </button>
          </div>
        </div>

        <div className="card settings-card">
          <div className="sc-head">
            <div className="card-title">
              <Icon name="database" size={16} />
              Data files
            </div>
            <div className="card-sub">Everything lives on this device</div>
          </div>
          <div className="sc-body">
            <div className="sync-summary">
              <div className="ss-row">
                <span className="k">Settings file</span>
                <span className="v mono">{sysInfo?.config_file || "—"}</span>
              </div>
              <div className="ss-row">
                <span className="k">Database file</span>
                <span className="v mono">{sysInfo?.data_file || "—"}</span>
              </div>
              <div className="ss-row">
                <span className="k">Platform</span>
                <span className="v">{sysInfo ? `${sysInfo.os} · ${sysInfo.arch}` : "—"}</span>
              </div>
              <div className="ss-row">
                <span className="k">Version</span>
                <span className="v">{sysInfo?.version || "1.0.0"}</span>
              </div>
            </div>
            <div className="callout info" style={{ marginTop: 0 }}>
              <Icon name="shield" size={16} />
              <div>
                The config file is written with owner-only permissions because it can hold API
                tokens and database credentials.
              </div>
            </div>
          </div>
        </div>

        <div className="card settings-card danger-zone">
          <div className="sc-head">
            <div className="card-title">
              <Icon name="alert" size={16} />
              Reset
            </div>
            <div className="card-sub">Run the wizard again, or erase everything</div>
          </div>
          <div className="sc-body">
            <div className="callout warning" style={{ marginTop: 0 }}>
              <Icon name="info" size={16} />
              <div>
                <strong>Run setup again</strong> keeps all sales and products — it only deletes the
                settings file so the wizard reappears.
              </div>
            </div>
            <button className="btn btn-outline btn-block" onClick={() => setResetOpen(true)}>
              <Icon name="undo" size={15} />
              Run setup wizard again
            </button>
            <div className="callout warning">
              <Icon name="alert" size={16} />
              <div>
                <strong>Factory reset</strong> deletes the settings, the local database and every
                receipt. It cannot be undone.
              </div>
            </div>
            <button className="btn btn-danger btn-block" onClick={() => setFactoryOpen(true)}>
              <Icon name="trash" size={15} />
              Factory reset
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Run setup again?"
        size="narrow"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setResetOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={runWizardReset}>
              Restart wizard
            </button>
          </>
        }
      >
        <p className="muted">
          Your sales history and product catalog are kept. The wizard will ask for the store
          details again.
        </p>
      </Modal>

      <Modal
        open={factoryOpen}
        onClose={() => setFactoryOpen(false)}
        title="Erase all local data?"
        size="narrow"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setFactoryOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={runFactoryReset} disabled={factoryBusy}>
              {factoryBusy ? <span className="spinner" /> : <Icon name="trash" size={15} />}
              Erase everything
            </button>
          </>
        }
      >
        <div className="callout warning" style={{ marginTop: 0 }}>
          <Icon name="alert" size={16} />
          <div>
            This deletes <strong>config.json</strong>, <strong>pos.db</strong> and the sync queue.
            Export anything you need before continuing.
          </div>
        </div>
      </Modal>
    </div>
  );
}
