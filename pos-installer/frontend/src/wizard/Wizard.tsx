import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SetupService } from "../../bindings/pos-installer";
import type { Config, InstallResult, SysInfo } from "../../bindings/pos-installer";
import { Icon } from "../components/Icon";
import { errorMessage, formatDateTime, CURRENCY_CODES } from "../lib/format";
import { toastError, toastSuccess } from "../lib/toast";

const STEP_LABELS = ["Welcome", "Store", "Counter", "Server", "Database", "Review"];

const emptyConfig = (): Config => ({
  warehouse_name: "",
  warehouse_location: "",
  counter_name: "",
  cashier_name: "",
  currency: "USD",
  server_url: "",
  server_token: "",
  db_host: "",
  db_name: "",
  db_user: "",
  db_pass: "",
  is_configured: false,
});

type Mode = "form" | "installing" | "done";

export default function Wizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<Mode>("form");
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sysInfo, setSysInfo] = useState<SysInfo | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    SetupService.GetSystemInfo()
      .then(setSysInfo)
      .catch(() => setSysInfo(null));
  }, []);

  const set = (field: keyof Config, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateStep = (current: number): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (current === 2) {
      if (!config.warehouse_name.trim()) errs.warehouse_name = "Warehouse name is required";
      if (!config.warehouse_location.trim()) errs.warehouse_location = "Location is required";
    }
    if (current === 3) {
      if (!config.counter_name.trim()) errs.counter_name = "Counter name is required";
      if (config.currency && !/^[A-Za-z]{3}$/.test(config.currency))
        errs.currency = "Use a 3-letter currency code";
    }
    if (current === 4 && config.server_url.trim()) {
      if (!/^https?:\/\/.+/i.test(config.server_url.trim()))
        errs.server_url = "Enter a full URL, e.g. https://api.example.com";
    }
    if (current === 5) {
      if (config.db_host.trim() && !config.db_name.trim()) errs.db_name = "Database name is required";
      if (config.db_host.trim() && !config.db_user.trim()) errs.db_user = "Database user is required";
    }
    return errs;
  };

  const goNext = () => {
    const errs = validateStep(step);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toastError("Please fix the highlighted fields");
      return;
    }
    setErrors({});
    setStep((s) => Math.min(s + 1, 6));
  };

  const goBack = () => {
    setErrors({});
    setStep((s) => Math.max(s - 1, 1));
  };

  const install = async () => {
    for (let s = 2; s <= 5; s++) {
      const errs = validateStep(s);
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        setStep(s);
        toastError("Some settings need attention before installing");
        return;
      }
    }
    setMode("installing");
    try {
      const res = await SetupService.Install(config);
      setResult(res);
      if (res.ok) {
        setMode("done");
        toastSuccess("Installation complete");
      } else {
        setMode("form");
        setStep(6);
        if (res.errors) {
          const errs: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.errors)) if (v) errs[k] = v;
          setErrors(errs);
        }
        toastError(res.message || "Installation failed");
      }
    } catch (err) {
      setMode("form");
      setStep(6);
      toastError(errorMessage(err));
    }
  };

  const jumpTo = (target: number) => {
    if (mode !== "form") return;
    if (target <= step) {
      setErrors({});
      setStep(target);
      return;
    }
    for (let s = step; s < target; s++) {
      const errs = validateStep(s);
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        setStep(s);
        toastError("Finish this step first");
        return;
      }
    }
    setErrors({});
    setStep(target);
  };

  const footerNote = useMemo(() => {
    if (mode === "installing") return "Installing — do not close the window.";
    if (mode === "done") return "Your POS is ready to use.";
    return `Step ${step} of ${STEP_LABELS.length}`;
  }, [mode, step]);

  return (
    <div className="wizard">
      <aside className="wizard-brand">
        <div className="brand-logo">
          <img src="/logo.svg" alt="" />
          <div>
            <div className="brand-name">Offline POS</div>
            <div className="brand-tag">Setup wizard</div>
          </div>
        </div>

        <div className="brand-pitch">
          <h2>Sell anywhere, even without internet.</h2>
          <p>
            This guided setup prepares your device: it creates the local database, seeds a starter
            catalog and stores your store profile — all on this machine.
          </p>
        </div>

        <ul className="brand-features">
          <li>
            <span className="feat-icon">
              <Icon name="shield" size={13} />
            </span>
            <span>
              <strong>Works offline</strong>
              <span>Sales are written to a local database first</span>
            </span>
          </li>
          <li>
            <span className="feat-icon">
              <Icon name="sync" size={13} />
            </span>
            <span>
              <strong>Optional cloud sync</strong>
              <span>Queue sales now, push them when a server is set</span>
            </span>
          </li>
          <li>
            <span className="feat-icon">
              <Icon name="box" size={13} />
            </span>
            <span>
              <strong>Ready-to-sell catalog</strong>
              <span>Seeded with common products you can edit later</span>
            </span>
          </li>
        </ul>

        <div className="brand-foot">
          <span>Version {sysInfo?.version || "1.0.0"}</span>
          <span>
            {sysInfo ? `${sysInfo.os} · ${sysInfo.arch}` : ""}
          </span>
        </div>
      </aside>

      <main className="wizard-main">
        <div className="wizard-steps">
          {STEP_LABELS.map((label, i) => {
            const num = i + 1;
            const state = num === step ? "active" : num < step ? "done" : "";
            return (
              <div key={label} style={{ display: "contents" }}>
                {i > 0 && (
                  <div className={`step-line ${num <= step ? "done" : ""}`} aria-hidden="true" />
                )}
                <button
                  type="button"
                  className={`step ${state}`}
                  onClick={() => jumpTo(num)}
                  style={{ background: "none", border: "none", cursor: "pointer" }}
                >
                  <span className="dot">{num < step ? <Icon name="check" size={13} /> : num}</span>
                  <span className="step-label">{label}</span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="wizard-scroll">
          {mode === "done" ? (
            <DonePanel result={result} sysInfo={sysInfo} onOpen={onDone} />
          ) : mode === "installing" ? (
            <InstallingPanel />
          ) : (
            <div className="wizard-card" key={step}>
              {step === 1 && <WelcomeStep sysInfo={sysInfo} />}
              {step === 2 && <StoreStep config={config} errors={errors} set={set} />}
              {step === 3 && <CounterStep config={config} errors={errors} set={set} />}
              {step === 4 && (
                <ServerStep
                  config={config}
                  errors={errors}
                  set={set}
                  showToken={showToken}
                  toggleToken={() => setShowToken((v) => !v)}
                />
              )}
              {step === 5 && <DatabaseStep config={config} errors={errors} set={set} />}
              {step === 6 && <ReviewStep config={config} sysInfo={sysInfo} errors={errors} />}
            </div>
          )}
        </div>

        <div className="wizard-footer">
          <span className="footer-note">{footerNote}</span>
          <div className="footer-actions">
            {mode === "form" && step > 1 && (
              <button className="btn btn-outline" onClick={goBack}>
                <Icon name="chevronLeft" size={15} />
                Back
              </button>
            )}
            {mode === "form" && step < 6 && (
              <button className="btn btn-primary" onClick={goNext}>
                Continue
                <Icon name="arrowRight" size={15} />
              </button>
            )}
            {mode === "form" && step === 6 && (
              <button className="btn btn-primary btn-lg" onClick={install}>
                <Icon name="zap" size={16} />
                Install now
              </button>
            )}
            {mode === "done" && (
              <button className="btn btn-primary btn-lg" onClick={onDone}>
                Open Offline POS
                <Icon name="arrowRight" size={16} />
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function WelcomeStep({ sysInfo }: { sysInfo: SysInfo | null }) {
  return (
    <>
      <div className="step-kicker">Step 1 · Welcome</div>
      <h1>Let&apos;s set up your point of sale</h1>
      <p className="step-lead">
        Six short steps and you are selling. Nothing here needs an internet connection — you can
        add a sync server later from Settings.
      </p>

      <div className="info-panel">
        <div className="info-row">
          <span className="k">Product</span>
          <span className="v">{sysInfo?.product_name || "Offline POS"}</span>
        </div>
        <div className="info-row">
          <span className="k">Platform</span>
          <span className="v">{sysInfo ? `${sysInfo.os} · ${sysInfo.arch}` : "detecting…"}</span>
        </div>
        <div className="info-row">
          <span className="k">Settings file</span>
          <span className="v">{sysInfo?.config_file || "—"}</span>
        </div>
        <div className="info-row">
          <span className="k">Database file</span>
          <span className="v">{sysInfo?.data_file || "—"}</span>
        </div>
      </div>

      <div className="callout info">
        <Icon name="info" size={16} />
        <div>
          You will define your <strong>store</strong>, <strong>counter</strong>, and optionally a{" "}
          <strong>sync server</strong>. The wizard runs only once — after that the app opens
          straight into the POS.
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`field ${className || ""}`}>
      <label>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

function StoreStep({
  config,
  errors,
  set,
}: {
  config: Config;
  errors: Record<string, string>;
  set: (f: keyof Config, v: string) => void;
}) {
  return (
    <>
      <div className="step-kicker">Step 2 · Store</div>
      <h1>Where is this store?</h1>
      <p className="step-lead">
        This shows up on receipts and in reports so you can tell locations apart.
      </p>
      <div className="form-grid">
        <Field label="Warehouse name" error={errors.warehouse_name} className="span-2">
          <input
            className={`input ${errors.warehouse_name ? "invalid" : ""}`}
            value={config.warehouse_name}
            onChange={(e) => set("warehouse_name", e.target.value)}
            placeholder="Main Warehouse"
            autoFocus
          />
        </Field>
        <Field label="Location" error={errors.warehouse_location} className="span-2">
          <input
            className={`input ${errors.warehouse_location ? "invalid" : ""}`}
            value={config.warehouse_location}
            onChange={(e) => set("warehouse_location", e.target.value)}
            placeholder="Dhaka, Bangladesh"
          />
        </Field>
      </div>
    </>
  );
}

function CounterStep({
  config,
  errors,
  set,
}: {
  config: Config;
  errors: Record<string, string>;
  set: (f: keyof Config, v: string) => void;
}) {
  return (
    <>
      <div className="step-kicker">Step 3 · Counter</div>
      <h1>Who is selling, and in which currency?</h1>
      <p className="step-lead">
        The counter name appears on every receipt. The currency decides how prices are displayed
        across the app.
      </p>
      <div className="form-grid">
        <Field label="Counter name" error={errors.counter_name}>
          <input
            className={`input ${errors.counter_name ? "invalid" : ""}`}
            value={config.counter_name}
            onChange={(e) => set("counter_name", e.target.value)}
            placeholder="Counter 1"
            autoFocus
          />
        </Field>
        <Field label="Cashier name" hint="Optional — the person at the till">
          <input
            className="input"
            value={config.cashier_name}
            onChange={(e) => set("cashier_name", e.target.value)}
            placeholder="Operator"
          />
        </Field>
        <Field label="Currency" error={errors.currency}>
          <select
            className={`select ${errors.currency ? "invalid" : ""}`}
            value={config.currency}
            onChange={(e) => set("currency", e.target.value)}
          >
            {CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </>
  );
}

function ServerStep({
  config,
  errors,
  set,
  showToken,
  toggleToken,
}: {
  config: Config;
  errors: Record<string, string>;
  set: (f: keyof Config, v: string) => void;
  showToken: boolean;
  toggleToken: () => void;
}) {
  return (
    <>
      <div className="step-kicker">Step 4 · Server</div>
      <h1>Connect a sync server (optional)</h1>
      <p className="step-lead">
        Leave this blank to run fully offline. If you add a server, sales are queued locally and
        pushed to <span className="mono">POST {config.server_url || "<server>"}&#47;api&#47;sales</span>{" "}
        whenever a connection is available.
      </p>
      <div className="form-grid">
        <Field label="Server URL" error={errors.server_url} className="span-2">
          <input
            className={`input mono ${errors.server_url ? "invalid" : ""}`}
            value={config.server_url}
            onChange={(e) => set("server_url", e.target.value)}
            placeholder="https://api.example.com"
            autoFocus
          />
        </Field>
        <Field label="API token" className="span-2" hint="Sent as a Bearer token. Stored locally with owner-only permissions.">
          <div className="input-affix">
            <span className="affix-icon">
              <Icon name="key" size={15} />
            </span>
            <input
              className="input mono"
              type={showToken ? "text" : "password"}
              value={config.server_token}
              onChange={(e) => set("server_token", e.target.value)}
              placeholder="sk_live_…"
              autoComplete="off"
            />
            <span className="affix-action">
              <button type="button" className="btn btn-ghost btn-icon" onClick={toggleToken}>
                <Icon name={showToken ? "eyeOff" : "eye"} size={15} />
              </button>
            </span>
          </div>
        </Field>
      </div>
      <div className="callout warning">
        <Icon name="alert" size={16} />
        <div>
          Without a server the app is <strong>local-only</strong> — perfectly fine for a single
          till. You can configure this later in <strong>Settings → Server &amp; sync</strong>.
        </div>
      </div>
    </>
  );
}

function DatabaseStep({
  config,
  errors,
  set,
}: {
  config: Config;
  errors: Record<string, string>;
  set: (f: keyof Config, v: string) => void;
}) {
  return (
    <>
      <div className="step-kicker">Step 5 · Database</div>
      <h1>External database mirror (optional)</h1>
      <p className="step-lead">
        The app already stores everything in an embedded database on this device. Fill this in
        only if you keep a central SQL server for reporting.
      </p>
      <div className="form-grid">
        <Field label="Host" className="span-2">
          <input
            className="input mono"
            value={config.db_host}
            onChange={(e) => set("db_host", e.target.value)}
            placeholder="db.example.com — leave empty to skip"
            autoFocus
          />
        </Field>
        <Field label="Database name" error={errors.db_name}>
          <input
            className={`input mono ${errors.db_name ? "invalid" : ""}`}
            value={config.db_name}
            onChange={(e) => set("db_name", e.target.value)}
            placeholder="pos_db"
          />
        </Field>
        <Field label="User" error={errors.db_user}>
          <input
            className={`input mono ${errors.db_user ? "invalid" : ""}`}
            value={config.db_user}
            onChange={(e) => set("db_user", e.target.value)}
            placeholder="pos_user"
          />
        </Field>
        <Field label="Password" className="span-2">
          <input
            className="input mono"
            type="password"
            value={config.db_pass}
            onChange={(e) => set("db_pass", e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>
      </div>
      <div className="callout info">
        <Icon name="database" size={16} />
        <div>
          Skipping this is safe: the till keeps using <span className="mono">pos.db</span> next to
          your config file.
        </div>
      </div>
    </>
  );
}

function ReviewStep({
  config,
  sysInfo,
  errors,
}: {
  config: Config;
  sysInfo: SysInfo | null;
  errors: Record<string, string>;
}) {
  const items: Array<{ label: string; value: string; empty?: boolean }> = [
    {
      label: "Warehouse",
      value: config.warehouse_name
        ? `${config.warehouse_name} — ${config.warehouse_location}`
        : "",
      empty: !config.warehouse_name,
    },
    {
      label: "Counter",
      value: config.counter_name
        ? `${config.counter_name}${config.cashier_name ? ` · ${config.cashier_name}` : ""}`
        : "",
      empty: !config.counter_name,
    },
    { label: "Currency", value: config.currency || "USD" },
    {
      label: "Sync server",
      value: config.server_url || "Local only (no server)",
      empty: !config.server_url,
    },
    {
      label: "Database mirror",
      value: config.db_host ? `${config.db_host}/${config.db_name}` : "Embedded (pos.db)",
      empty: !config.db_host,
    },
    { label: "Settings file", value: sysInfo?.config_file || "—" },
  ];

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <>
      <div className="step-kicker">Step 6 · Review &amp; install</div>
      <h1>Everything look right?</h1>
      <p className="step-lead">
        Installing creates the folders, initializes the database, seeds the product catalog and
        writes your settings.
      </p>

      <div className="review-grid">
        {items.map((item) => (
          <div className="review-item" key={item.label}>
            <span className="r-label">{item.label}</span>
            <span className={`r-value ${item.empty ? "empty-val" : ""}`}>
              {item.empty ? "Not set" : item.value}
            </span>
          </div>
        ))}
      </div>

      {hasErrors && (
        <div className="callout warning">
          <Icon name="alert" size={16} />
          <div>
            <strong>Some fields need attention:</strong>
            <br />
            {Object.entries(errors)
              .map(([field, msg]) => `${field}: ${msg}`)
              .join(" · ")}
          </div>
        </div>
      )}
    </>
  );
}

function InstallingPanel() {
  const placeholders = [
    "Validating settings",
    "Creating application folders",
    "Initializing local database",
    "Seeding product catalog",
    "Writing configuration",
    "Verifying installation",
  ];
  return (
    <div className="wizard-card">
      <div className="step-kicker">Installing</div>
      <h1>Preparing your POS…</h1>
      <p className="step-lead">This takes just a moment.</p>
      <div className="install-steps">
        {placeholders.map((title, i) => (
          <div className="install-step" key={title} style={{ animationDelay: `${i * 60}ms` }}>
            <span className="st-icon">
              <span className="spinner dark" />
            </span>
            <div className="st-body">
              <div className="st-title">{title}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DonePanel({
  result,
  sysInfo,
  onOpen,
}: {
  result: InstallResult | null;
  sysInfo: SysInfo | null;
  onOpen: () => void;
}) {
  const verify = result?.steps?.find((s) => s.title === "Verify installation");
  return (
    <div className="wizard-card">
      <div className="success-hero">
        <div className="success-ring">
          <Icon name="checkCircle" size={40} strokeWidth={1.7} />
        </div>
        <h1>Installation complete</h1>
        <p>
          {verify?.detail || "Your offline database is ready."} Launch the POS to start selling —
          the wizard will not run again unless you reset it from Settings.
        </p>
      </div>

      <div className="info-panel">
        {(result?.steps || []).map((s) => (
          <div className="info-row" key={s.title}>
            <span className="k">{s.title}</span>
            <span className="v" style={{ color: s.ok ? "var(--success)" : "var(--danger)" }}>
              {s.ok ? "OK" : "FAILED"}
            </span>
          </div>
        ))}
        <div className="info-row">
          <span className="k">Installed</span>
          <span className="v">{formatDateTime(new Date().toISOString())}</span>
        </div>
        <div className="info-row">
          <span className="k">Data file</span>
          <span className="v">{result?.data_file || sysInfo?.data_file || "—"}</span>
        </div>
      </div>

      <div className="callout success">
        <Icon name="check" size={16} />
        <div>
          Next: open the POS, tap a few products to build a cart, then press{" "}
          <strong>Charge</strong>. You can edit the catalog any time under{" "}
          <strong>Products</strong>.
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
        <button className="btn btn-primary btn-lg" onClick={onOpen}>
          Open Offline POS
          <Icon name="arrowRight" size={16} />
        </button>
      </div>
    </div>
  );
}
