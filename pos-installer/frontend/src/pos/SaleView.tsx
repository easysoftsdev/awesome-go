import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PosService, type Product, type Sale } from "../../bindings/pos-installer";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import Receipt from "./Receipt";
import { useApp } from "./context";
import {
  errorMessage,
  formatMoney,
  formatQty,
  parseMoneyToCents,
} from "../lib/format";
import { toastError } from "../lib/toast";

type Line = { product: Product; qty: number };

const CATEGORY_COLORS = ["#2563eb", "#0f9d6e", "#c2740b", "#7c3aed", "#0e7490", "#d92d20", "#db2777", "#4f46e5"];

function categoryColor(category: string): string {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return CATEGORY_COLORS[h % CATEGORY_COLORS.length];
}

export default function SaleView() {
  const { config, refreshSync } = useApp();
  const currency = config.currency || "USD";

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [customer, setCustomer] = useState("");
  const [discountInput, setDiscountInput] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);

  const loadProducts = useCallback(async () => {
    try {
      const [list, cats] = await Promise.all([
        PosService.GetProducts({ query: debounced, category, include_archived: false, low_stock_only: false }),
        PosService.GetCategories(),
      ]);
      setProducts(list || []);
      setCategories(cats || []);
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [debounced, category]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 170);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const subtotalCents = useMemo(
    () => cart.reduce((sum, line) => sum + line.product.price_cents * line.qty, 0),
    [cart],
  );

  const discountCents = useMemo(() => {
    const cents = parseMoneyToCents(discountInput, currency);
    if (cents < 0) return 0;
    return Math.min(cents, subtotalCents);
  }, [discountInput, subtotalCents, currency]);

  const totalCents = Math.max(0, subtotalCents - discountCents);
  const itemCount = cart.reduce((sum, line) => sum + line.qty, 0);

  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
      toastError(`${product.name} is out of stock`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        if (existing.qty + 1 > product.stock) {
          toastError(`Only ${formatQty(product.stock)} ${product.unit} left of ${product.name}`);
          return prev;
        }
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l,
        );
      }
      return [...prev, { product, qty: 1 }];
    });
  };

  const setQty = (productId: number, qty: number) => {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.product.id !== productId) return l;
          const clamped = Math.min(Math.max(qty, 0), l.product.stock);
          return { ...l, qty: clamped };
        })
        .filter((l) => l.qty > 0),
    );
  };

  const removeLine = (productId: number) => {
    setCart((prev) => prev.filter((l) => l.product.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setDiscountInput("");
    setCustomer("");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (payOpen || receipt) return;
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "F4" && cart.length > 0) {
        e.preventDefault();
        setPayOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payOpen, receipt, cart.length]);

  return (
    <div className="view-scroll no-pad">
      <div className="sale-layout">
        <section className="sale-catalog">
          <div className="cat-head">
            <div className="input-affix search">
              <span className="affix-icon">
                <Icon name="search" size={15} />
              </span>
              <input
                ref={searchRef}
                className="input"
                placeholder="Search name or SKU…  (F2)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <span className="badge badge-brand">
              {products.length} product{products.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="cat-chips">
            {["All", ...categories].map((c) => (
              <button
                key={c}
                className={`chip ${category === c ? "active" : ""}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {loadError ? (
            <div className="empty">
              <Icon name="alert" size={30} />
              <div className="empty-title">Could not load products</div>
              <div className="empty-sub">{loadError}</div>
              <button className="btn btn-outline" onClick={loadProducts}>
                Retry
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="empty">
              <Icon name="search" size={30} />
              <div className="empty-title">No products match</div>
              <div className="empty-sub">
                Try a different search, or add the product from the Products screen.
              </div>
            </div>
          ) : (
            <div className="product-grid">
              {products.map((p) => {
                const color = categoryColor(p.category);
                const inCart = cart.find((l) => l.product.id === p.id)?.qty || 0;
                const out = p.stock - inCart <= 0;
                const low = !out && p.stock <= p.reorder_level;
                return (
                  <button
                    key={p.id}
                    className="product-card"
                    onClick={() => addToCart(p)}
                    disabled={out}
                    title={`${p.name} — ${p.sku}`}
                  >
                    <span className="p-cat-stripe" style={{ background: color }} />
                    <span className="p-name">{p.name}</span>
                    <span className="p-meta">{p.sku}</span>
                    <span className="p-foot">
                      <span className="p-price">{formatMoney(p.price_cents, currency)}</span>
                      <span className={`p-stock ${out ? "out" : low ? "low" : ""}`}>
                        {out ? "Out" : `${formatQty(p.stock)} ${p.unit}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="cart-panel">
          <div className="cart-head">
            <div className="ch-row">
              <span className="ch-title">
                <Icon name="cart" size={17} /> Current sale
              </span>
              {cart.length > 0 && (
                <span className="ch-count">
                  {formatQty(itemCount)} item{itemCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="customer-row">
              <input
                className="input"
                placeholder="Customer name (optional)"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              />
              <button
                className="btn btn-ghost btn-icon"
                onClick={clearCart}
                title="Clear cart"
                disabled={cart.length === 0}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </div>

          <div className="cart-lines">
            {cart.length === 0 ? (
              <div className="cart-empty">
                <span className="ce-icon">
                  <Icon name="cart" size={26} />
                </span>
                <span className="ce-title">Cart is empty</span>
                <span className="ce-sub">
                  Click products on the left to add them. Press F4 to charge once the cart has
                  items.
                </span>
              </div>
            ) : (
              cart.map((line) => (
                <div className="cart-line" key={line.product.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="cl-name">{line.product.name}</div>
                    <div className="cl-unit-price">
                      {formatMoney(line.product.price_cents, currency)} / {line.product.unit}
                    </div>
                  </div>
                  <div className="cl-total">
                    {formatMoney(line.product.price_cents * line.qty, currency)}
                  </div>
                  <div className="cl-controls">
                    <div className="qty-stepper">
                      <button onClick={() => setQty(line.product.id, line.qty - 1)} aria-label="Decrease">
                        <Icon name="minus" size={13} />
                      </button>
                      <span className="qty">
                        {formatQty(line.qty)}
                        <small>{line.product.unit}</small>
                      </span>
                      <button onClick={() => setQty(line.product.id, line.qty + 1)} aria-label="Increase">
                        <Icon name="plus" size={13} />
                      </button>
                    </div>
                    <button
                      className="remove-line"
                      onClick={() => removeLine(line.product.id)}
                      aria-label="Remove line"
                    >
                      <Icon name="x" size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="cart-summary">
            <div className="sum-row">
              <span>Subtotal</span>
              <span className="sv">{formatMoney(subtotalCents, currency)}</span>
            </div>
            <div className="sum-row discount-row">
              <span>Discount</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  disabled={cart.length === 0}
                  aria-label="Discount amount"
                />
              </span>
            </div>
            <div className="sum-row total">
              <span>Total</span>
              <span className="sv">{formatMoney(totalCents, currency)}</span>
            </div>
            <div className="cart-actions">
              <button
                className="btn btn-primary btn-lg btn-charge"
                disabled={cart.length === 0 || busy}
                onClick={() => setPayOpen(true)}
              >
                <Icon name="card" size={17} />
                Charge
                <span className="kbd-hint">F4</span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        totalCents={totalCents}
        itemCount={itemCount}
        currency={currency}
        busy={busy}
        onConfirm={async (method, paidCents) => {
          setBusy(true);
          try {
            const result = await PosService.Checkout({
              lines: cart.map((l) => ({ product_id: l.product.id, qty: l.qty })),
              payment_method: method,
              amount_paid_cents: paidCents,
              discount_cents: discountCents,
              customer,
              note: "",
            });
            setPayOpen(false);
            setReceipt(result.sale);
            clearCart();
            for (const warning of result.warnings || []) toastError(warning);
            loadProducts();
            refreshSync();
          } catch (err) {
            toastError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />

      <Modal
        open={receipt !== null}
        onClose={() => setReceipt(null)}
        title="Sale complete"
        subtitle={receipt ? `Receipt ${receipt.id}` : undefined}
        size="narrow"
        footer={
          <>
            <button
              className="btn btn-outline"
              onClick={() => {
                window.print();
              }}
            >
              <Icon name="printer" size={15} />
              Print
            </button>
            <button className="btn btn-primary" onClick={() => setReceipt(null)}>
              New sale
            </button>
          </>
        }
      >
        {receipt && <Receipt sale={receipt} config={config} />}
      </Modal>
    </div>
  );
}

function PaymentModal({
  open,
  onClose,
  totalCents,
  itemCount,
  currency,
  busy,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  totalCents: number;
  itemCount: number;
  currency: string;
  busy: boolean;
  onConfirm: (method: string, paidCents: number) => Promise<void>;
}) {
  const [method, setMethod] = useState("cash");
  const [paid, setPaid] = useState("");

  useEffect(() => {
    if (open) {
      setMethod("cash");
      setPaid("");
    }
  }, [open]);

  const paidCents = method === "cash" ? parseMoneyToCents(paid, currency) : totalCents;
  const change = paidCents - totalCents;
  const short = method === "cash" && paidCents < totalCents;
  const unit = 100;

  const quickValues = useMemo(() => {
    const values = new Set<number>();
    values.add(totalCents);
    for (const major of [5, 10, 20, 50, 100]) {
      const step = major * unit;
      const next = Math.ceil(totalCents / step) * step;
      if (next > totalCents) values.add(next);
      if (values.size >= 5) break;
    }
    return [...values].slice(0, 5);
  }, [totalCents]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Take payment"
      subtitle={`${formatQty(itemCount)} item${itemCount === 1 ? "" : "s"} · ${formatMoney(totalCents, currency)} due`}
      size="wide"
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-lg"
            disabled={busy || (method === "cash" && paidCents < totalCents)}
            onClick={() => onConfirm(method, paidCents)}
          >
            {busy ? <span className="spinner" /> : <Icon name="check" size={16} />}
            {busy ? "Processing…" : `Confirm ${formatMoney(totalCents, currency)}`}
          </button>
        </>
      }
    >
      <div className="pay-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field">
            <label>Payment method</label>
            <div className="pay-methods">
              {[
                { key: "cash", label: "Cash", icon: "cash" as const },
                { key: "card", label: "Card", icon: "card" as const },
                { key: "mobile", label: "Mobile", icon: "phone" as const },
              ].map((m) => (
                <button
                  key={m.key}
                  className={`pay-method ${method === m.key ? "active" : ""}`}
                  onClick={() => setMethod(m.key)}
                >
                  <Icon name={m.icon} size={19} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {method === "cash" && (
            <div className="field">
              <label>Amount received</label>
              <input
                className="input mono"
                inputMode="decimal"
                autoFocus
                placeholder={formatMoney(totalCents, currency)}
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
              />
              <div className="quick-cash">
                {quickValues.map((v) => (
                  <button key={v} onClick={() => setPaid((v / 100).toFixed(2))}>
                    {formatMoney(v, currency)}
                  </button>
                ))}
              </div>
              {short && <span className="error">Amount is less than the total</span>}
            </div>
          )}
        </div>

        <div className="pay-totals">
          <div className="pt-row">
            <span>Items</span>
            <strong>{formatQty(itemCount)}</strong>
          </div>
          <div className="pt-row grand">
            <span>Due</span>
            <strong>{formatMoney(totalCents, currency)}</strong>
          </div>
          <div className="pt-row">
            <span>Received</span>
            <strong>{formatMoney(paidCents, currency)}</strong>
          </div>
          <div className="pt-row change">
            <span>Change</span>
            <strong>{formatMoney(Math.max(0, change), currency)}</strong>
          </div>
          <div className="callout info" style={{ marginTop: 6 }}>
            <Icon name="info" size={15} />
            <div>The sale is saved locally first, then queued for sync if a server is set.</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
