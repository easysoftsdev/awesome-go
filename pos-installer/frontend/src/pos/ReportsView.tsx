import { useCallback, useEffect, useState } from "react";
import { PosService, type Dashboard } from "../../bindings/pos-installer";
import { Icon } from "../components/Icon";
import { useApp } from "./context";
import { errorMessage, formatMoney, formatQty, weekdayLabel } from "../lib/format";

function compactMoney(cents: number, code: string): string {
  const value = cents / 100;
  const symbol = formatMoney(0, code).replace(/0\.00$/, "");
  if (Math.abs(value) >= 1000000) return `${symbol}${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${symbol}${(value / 1000).toFixed(1)}k`;
  return `${symbol}${value.toFixed(0)}`;
}

export default function ReportsView() {
  const { config, goto } = useApp();
  const currency = config.currency || "USD";
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setDash(await PosService.GetDashboard());
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="view-scroll">
        <div className="empty">
          <Icon name="alert" size={30} />
          <div className="empty-title">Could not load reports</div>
          <div className="empty-sub">{error}</div>
          <button className="btn btn-outline" onClick={load}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!dash) {
    return (
      <div className="view-scroll">
        <div className="empty">
          <div className="spinner dark" />
          <div className="empty-sub">Crunching today&apos;s numbers…</div>
        </div>
      </div>
    );
  }

  const week = dash.week || [];
  const topProducts = dash.top_products || [];
  const lowStock = dash.low_stock || [];
  const maxRevenue = Math.max(...week.map((d) => d.revenue_cents), 1);
  const margin = dash.today_revenue_cents > 0
    ? Math.round((dash.today_profit_cents / dash.today_revenue_cents) * 100)
    : 0;
  const todayKey = week.length > 0 ? week[week.length - 1].date : "";

  return (
    <div className="view-scroll">
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-accent" />
          <div className="kpi">
            <span className="kpi-label">Revenue today</span>
            <span className="kpi-value">{formatMoney(dash.today_revenue_cents, currency)}</span>
            <span className="kpi-foot">
              <Icon name="clock" size={13} />
              since midnight
            </span>
          </div>
        </div>
        <div className="kpi-card accent-green">
          <span className="kpi-accent" />
          <div className="kpi">
            <span className="kpi-label">Transactions</span>
            <span className="kpi-value">{dash.today_transactions}</span>
            <span className="kpi-foot">
              <Icon name="cart" size={13} />
              {formatQty(dash.today_items)} items sold
            </span>
          </div>
        </div>
        <div className="kpi-card accent-purple">
          <span className="kpi-accent" />
          <div className="kpi">
            <span className="kpi-label">Average basket</span>
            <span className="kpi-value">{formatMoney(dash.avg_basket_cents, currency)}</span>
            <span className="kpi-foot">
              <Icon name="receipt" size={13} />
              per transaction
            </span>
          </div>
        </div>
        <div className="kpi-card accent-amber">
          <span className="kpi-accent" />
          <div className="kpi">
            <span className="kpi-label">Gross profit today</span>
            <span className="kpi-value">{formatMoney(dash.today_profit_cents, currency)}</span>
            <span className="kpi-foot">
              <Icon name="chart" size={13} />
              {margin}% margin
            </span>
          </div>
        </div>
      </div>

      <div className="reports-grid">
        <div className="card card-pad">
          <div className="card-title">
            <Icon name="chart" size={16} />
            Last 7 days
          </div>
          <div className="card-sub">Daily revenue, completed sales only</div>
          <div className="bar-chart">
            {week.map((day) => {
              const height = Math.max(3, Math.round((day.revenue_cents / maxRevenue) * 100));
              const isToday = day.date === todayKey;
              return (
                <div className="bar-col" key={day.date}>
                  <span className="bar-value">
                    {day.revenue_cents > 0 ? compactMoney(day.revenue_cents, currency) : "—"}
                  </span>
                  <div
                    className={`bar ${isToday ? "today" : ""}`}
                    style={{ height: `${height}%` }}
                    title={`${day.date}: ${formatMoney(day.revenue_cents, currency)} · ${day.transactions} sales`}
                  />
                  <span className="bar-label">
                    {weekdayLabel(day.date)}
                    <br />
                    <span className="subtle">{day.date.slice(8)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card card-pad">
          <div className="card-title">
            <Icon name="tag" size={16} />
            Top products · 7 days
          </div>
          <div className="card-sub">Ranked by revenue</div>
          <div className="rank-list" style={{ marginTop: 8 }}>
            {topProducts.length === 0 ? (
              <div className="empty" style={{ padding: "26px 10px" }}>
                <div className="empty-sub">
                  No sales yet this week — ring up a sale to see rankings.
                </div>
              </div>
            ) : (
              topProducts.map((p, i) => (
                <div className="rank-item" key={`${p.product_id}-${i}`}>
                  <span className="rank-pos">{i + 1}</span>
                  <div className="rank-body">
                    <div className="rank-name">{p.name}</div>
                    <div className="rank-meta">{formatQty(p.qty)} sold</div>
                  </div>
                  <span className="rank-value">{formatMoney(p.revenue_cents, currency)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card card-pad full">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div className="card-title">
                <Icon name="alert" size={16} />
                Low stock alerts
              </div>
              <div className="card-sub">
                {dash.product_count} products in the catalog · {dash.pending_sync} sale(s) waiting to sync
              </div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => goto("products")}>
              Manage products
              <Icon name="arrowRight" size={14} />
            </button>
          </div>

          <div className="stock-list" style={{ marginTop: 10 }}>
            {lowStock.length === 0 ? (
              <div className="empty" style={{ padding: "22px 10px" }}>
                <Icon name="checkCircle" size={26} />
                <div className="empty-title">All stock levels look healthy</div>
              </div>
            ) : (
              lowStock.map((p) => (
                <div className="stock-item" key={p.id}>
                  <span className={`badge ${p.stock <= 0 ? "badge-danger" : "badge-warning"}`}>
                    {p.stock <= 0 ? "Out" : "Low"}
                  </span>
                  <div className="si-body">
                    <div className="si-name">{p.name}</div>
                    <div className="si-meta">
                      {p.sku} · reorder at {formatQty(p.reorder_level)} {p.unit}
                    </div>
                  </div>
                  <span className="rank-value">
                    {formatQty(p.stock)} {p.unit}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
