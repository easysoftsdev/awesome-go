import type { Config, Sale } from "../../bindings/pos-installer";
import { formatMoney, formatQty } from "../lib/format";

export default function Receipt({ sale, config }: { sale: Sale; config: Config }) {
  const currency = config.currency || "USD";
  return (
    <div className="receipt print-area">
      <div className="r-head">
        <div className="r-store">{config.warehouse_name || "Offline POS"}</div>
        <div className="r-meta">
          {config.counter_name} · {config.cashier_name || "Operator"}
        </div>
        <div className="r-meta">
          Receipt <span className="r-id">{sale.id}</span> ·{" "}
          {new Date(sale.created_at).toLocaleString()}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Price</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {(sale.items ?? []).map((item, idx) => (
            <tr key={`${item.product_id}-${idx}`}>
              <td>
                {item.name}
                <div className="subtle" style={{ fontSize: 11 }}>
                  {item.sku}
                </div>
              </td>
              <td className="num">{formatQty(item.qty)}</td>
              <td className="num">{formatMoney(item.unit_price_cents, currency)}</td>
              <td className="num">{formatMoney(item.line_total_cents, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="r-totals">
        <div className="rt-row">
          <span>Subtotal</span>
          <strong>{formatMoney(sale.subtotal_cents, currency)}</strong>
        </div>
        {sale.discount_cents > 0 && (
          <div className="rt-row">
            <span>Discount</span>
            <strong>-{formatMoney(sale.discount_cents, currency)}</strong>
          </div>
        )}
        <div className="rt-row grand">
          <span>Total</span>
          <strong>{formatMoney(sale.total_cents, currency)}</strong>
        </div>
        <div className="rt-row">
          <span>Paid ({sale.payment_method})</span>
          <strong>{formatMoney(sale.amount_paid_cents, currency)}</strong>
        </div>
        <div className="rt-row">
          <span>Change</span>
          <strong>{formatMoney(sale.change_cents, currency)}</strong>
        </div>
        <div className="rt-row">
          <span>Status</span>
          <strong style={{ color: sale.status === "voided" ? "var(--danger)" : "var(--success)" }}>
            {sale.status === "voided" ? "Voided" : "Completed"}
          </strong>
        </div>
      </div>

      <div className="r-foot">
        {sale.customer && sale.customer !== "Walk-in" ? `Customer: ${sale.customer} · ` : ""}
        {sale.note ? `${sale.note} · ` : ""}
        {sale.sync_state === "synced" ? "synced to server" : "saved offline · syncs when available"}
        <br />
        Thank you for your purchase!
      </div>
    </div>
  );
}
