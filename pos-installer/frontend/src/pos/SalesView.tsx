import { useCallback, useEffect, useState } from "react";
import { PosService, type Sale, type SaleSummary } from "../../bindings/pos-installer";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import Receipt from "./Receipt";
import { useApp } from "./context";
import { errorMessage, formatDateTime, formatMoney, formatQty, relativeTime } from "../lib/format";
import { toastError, toastSuccess } from "../lib/toast";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All" },
] as const;

export default function SalesView() {
  const { config, refreshSync } = useApp();
  const currency = config.currency || "USD";

  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("today");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detail, setDetail] = useState<Sale | null>(null);
  const [voidTarget, setVoidTarget] = useState<SaleSummary | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await PosService.GetSales({ range, query: debounced, limit: 300 });
      setSales(list || []);
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [range, debounced]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 170);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (summary: SaleSummary) => {
    try {
      setDetail(await PosService.GetSale(summary.id));
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  const confirmVoid = async () => {
    if (!voidTarget) return;
    setBusy(true);
    try {
      await PosService.VoidSale(voidTarget.id, voidReason.trim());
      toastSuccess(`Receipt ${voidTarget.id} voided — stock restored`);
      setVoidTarget(null);
      setVoidReason("");
      setDetail(null);
      load();
      refreshSync();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const totals = sales.reduce(
    (acc, s) => (s.status === "completed" ? { ...acc, count: acc.count + 1, sum: acc.sum + s.total_cents } : acc),
    { count: 0, sum: 0 },
  );

  return (
    <div className="view-scroll">
      <div className="toolbar">
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={`chip ${range === r.key ? "active" : ""}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
        <div className="input-affix search">
          <span className="affix-icon">
            <Icon name="search" size={15} />
          </span>
          <input
            className="input"
            placeholder="Search receipt, customer or item…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="spacer" />
        <span className="badge badge-brand">
          {totals.count} sale{totals.count === 1 ? "" : "s"} · {formatMoney(totals.sum, currency)}
        </span>
      </div>

      <div className="data-card">
        {loadError ? (
          <div className="empty">
            <Icon name="alert" size={30} />
            <div className="empty-title">Could not load sales</div>
            <div className="empty-sub">{loadError}</div>
            <button className="btn btn-outline" onClick={load}>
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="empty">
            <div className="spinner dark" />
            <div className="empty-sub">Loading receipts…</div>
          </div>
        ) : sales.length === 0 ? (
          <div className="empty">
            <Icon name="receipt" size={30} />
            <div className="empty-title">No sales in this range</div>
            <div className="empty-sub">
              Completed receipts will appear here with their sync state.
            </div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>When</th>
                <th>Customer</th>
                <th>Payment</th>
                <th className="num">Items</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th>Sync</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => openDetail(s)}>
                  <td>
                    <div className="mono" style={{ fontWeight: 650 }}>
                      {s.id}
                    </div>
                    <div className="subtle" style={{ fontSize: 11.5 }}>
                      {s.counter}
                      {s.first_item_name ? ` · ${s.first_item_name}` : ""}
                    </div>
                  </td>
                  <td>
                    <div>{formatDateTime(s.created_at)}</div>
                    <div className="subtle" style={{ fontSize: 11.5 }}>
                      {relativeTime(s.created_at)}
                    </div>
                  </td>
                  <td>{s.customer}</td>
                  <td style={{ textTransform: "capitalize" }}>{s.payment_method}</td>
                  <td className="num">{formatQty(s.item_count)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {formatMoney(s.total_cents, currency)}
                  </td>
                  <td>
                    {s.status === "voided" ? (
                      <span className="badge badge-danger">Voided</span>
                    ) : (
                      <span className="badge badge-success">Completed</span>
                    )}
                  </td>
                  <td>
                    <SyncBadge state={s.sync_state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && sales.length > 0 && (
          <div className="pager">
            <span>
              Showing {sales.length} receipt{sales.length === 1 ? "" : "s"}
            </span>
            <span className="subtle">Click a row for details</span>
          </div>
        )}
      </div>

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `Receipt ${detail.id}` : ""}
        subtitle={detail ? formatDateTime(detail.created_at) : undefined}
        size="medium"
        footer={
          detail ? (
            <>
              <button className="btn btn-outline" onClick={() => window.print()}>
                <Icon name="printer" size={15} />
                Print
              </button>
              {detail.status === "completed" && detail.sync_state !== "synced" && (
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    setVoidTarget(sales.find((s) => s.id === detail.id) || null);
                    setVoidReason("");
                  }}
                >
                  <Icon name="undo" size={15} />
                  Void sale
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setDetail(null)}>
                Close
              </button>
            </>
          ) : null
        }
      >
        {detail && <Receipt sale={detail} config={config} />}
      </Modal>

      <Modal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        title="Void this receipt?"
        subtitle={voidTarget ? voidTarget.id : undefined}
        size="narrow"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setVoidTarget(null)}>
              Keep it
            </button>
            <button className="btn btn-danger" onClick={confirmVoid} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="undo" size={15} />}
              Void sale
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="callout warning" style={{ marginTop: 0 }}>
            <Icon name="alert" size={16} />
            <div>
              Stock is returned to the shelf and the receipt is marked <strong>voided</strong>. This
              only works while the sale has not been synced to the server.
            </div>
          </div>
          <div className="field">
            <label>Reason (optional)</label>
            <input
              className="input"
              autoFocus
              placeholder="Wrong item, customer changed mind…"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SyncBadge({ state }: { state: string }) {
  if (state === "synced") {
    return (
      <span className="badge badge-success">
        <span className="dot" />
        Synced
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="badge badge-danger">
        <span className="dot" />
        Failed
      </span>
    );
  }
  return (
    <span className="badge badge-warning">
      <span className="dot" />
      Queued
    </span>
  );
}
