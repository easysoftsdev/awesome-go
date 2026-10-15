import { useCallback, useEffect, useMemo, useState } from "react";
import { PosService, type Product } from "../../bindings/pos-installer";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { useApp } from "./context";
import {
  errorMessage,
  formatMoney,
  formatQty,
  parseMoneyToCents,
} from "../lib/format";
import { toastError, toastSuccess } from "../lib/toast";

type Draft = {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  price: string;
  cost: string;
  stock: string;
  reorder_level: string;
};

const emptyDraft = (): Draft => ({
  id: 0,
  sku: "",
  name: "",
  category: "",
  unit: "pc",
  price: "",
  cost: "",
  stock: "0",
  reorder_level: "5",
});

export default function ProductsView() {
  const { config } = useApp();
  const currency = config.currency || "USD";

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, cats] = await Promise.all([
        PosService.GetProducts({
          query: debounced,
          category: "",
          include_archived: showArchived,
          low_stock_only: false,
        }),
        PosService.GetCategories(),
      ]);
      setProducts(list || []);
      setCategories(cats || []);
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [debounced, showArchived]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 170);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setDraft(emptyDraft());
    setDraftErrors({});
  };

  const openEdit = (p: Product) => {
    setDraft({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unit: p.unit,
      price: (p.price_cents / 100).toFixed(2),
      cost: (p.cost_cents / 100).toFixed(2),
      stock: String(p.stock),
      reorder_level: String(p.reorder_level),
    });
    setDraftErrors({});
  };

  const saveDraft = async () => {
    if (!draft) return;
    const errs: Record<string, string> = {};
    if (!draft.name.trim()) errs.name = "Name is required";
    if (!draft.category.trim()) errs.category = "Category is required";
    if (!draft.unit.trim()) errs.unit = "Unit is required";
    if (!draft.price.trim() || parseMoneyToCents(draft.price) < 0) errs.price = "Enter a price";
    if (Number.isNaN(Number.parseFloat(draft.stock)) || Number.parseFloat(draft.stock) < 0)
      errs.stock = "Stock must be zero or more";
    if (Number.isNaN(Number.parseFloat(draft.reorder_level)) || Number.parseFloat(draft.reorder_level) < 0)
      errs.reorder_level = "Use zero or more";
    if (Object.keys(errs).length > 0) {
      setDraftErrors(errs);
      return;
    }

    setSaving(true);
    try {
      await PosService.SaveProduct({
        id: draft.id,
        sku: draft.sku.trim(),
        name: draft.name.trim(),
        category: draft.category.trim(),
        unit: draft.unit.trim(),
        price_cents: parseMoneyToCents(draft.price),
        cost_cents: parseMoneyToCents(draft.cost),
        stock: Number.parseFloat(draft.stock),
        reorder_level: Number.parseFloat(draft.reorder_level),
        archived: false,
        updated_at: "",
      });
      toastSuccess(draft.id ? "Product updated" : "Product added");
      setDraft(null);
      load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const archiveToggle = async (p: Product) => {
    try {
      await PosService.ArchiveProduct(p.id, !p.archived);
      toastSuccess(p.archived ? "Product restored" : "Product archived");
      setArchiveTarget(null);
      load();
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  const lowCount = useMemo(
    () => products.filter((p) => !p.archived && p.stock <= p.reorder_level).length,
    [products],
  );

  return (
    <div className="view-scroll">
      <div className="toolbar">
        <div className="input-affix search">
          <span className="affix-icon">
            <Icon name="search" size={15} />
          </span>
          <input
            className="input"
            placeholder="Search products…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {lowCount > 0 && (
          <span className="badge badge-warning">
            <Icon name="alert" size={12} />
            {lowCount} low stock
          </span>
        )}
        <label className="chip" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            style={{ margin: 0 }}
          />
          Archived
        </label>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={openNew}>
          <Icon name="plus" size={15} />
          New product
        </button>
      </div>

      {categories.length > 0 && (
        <div className="cat-chips" style={{ marginTop: -6 }}>
          <span className="badge" style={{ padding: "6px 12px" }}>
            {categories.length} categories
          </span>
          {categories.slice(0, 8).map((c) => (
            <span key={c} className="chip" style={{ cursor: "default" }}>
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="data-card">
        {loadError ? (
          <div className="empty">
            <Icon name="alert" size={30} />
            <div className="empty-title">Could not load products</div>
            <div className="empty-sub">{loadError}</div>
            <button className="btn btn-outline" onClick={load}>
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="empty">
            <div className="spinner dark" />
            <div className="empty-sub">Loading catalog…</div>
          </div>
        ) : products.length === 0 ? (
          <div className="empty">
            <Icon name="box" size={30} />
            <div className="empty-title">No products yet</div>
            <div className="empty-sub">
              Add your first product or run the wizard again to re-seed the starter catalog.
            </div>
            <button className="btn btn-primary" onClick={openNew}>
              <Icon name="plus" size={15} />
              New product
            </button>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th className="num">Price</th>
                <th className="num">Cost</th>
                <th className="num">Stock</th>
                <th>Status</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const out = p.stock <= 0;
                const low = !out && p.stock <= p.reorder_level;
                return (
                  <tr key={p.id} className={p.archived ? "subtle" : ""}>
                    <td>
                      <div style={{ fontWeight: 650, opacity: p.archived ? 0.65 : 1 }}>{p.name}</div>
                      <div className="subtle mono" style={{ fontSize: 11.5 }}>
                        {p.sku} · per {p.unit}
                      </div>
                    </td>
                    <td>{p.category}</td>
                    <td className="num">{formatMoney(p.price_cents, currency)}</td>
                    <td className="num subtle">{formatMoney(p.cost_cents, currency)}</td>
                    <td className="num">
                      <span className={`badge ${out ? "badge-danger" : low ? "badge-warning" : "badge-success"}`}>
                        {formatQty(p.stock)} {p.unit}
                      </span>
                    </td>
                    <td>
                      {p.archived ? (
                        <span className="badge">Archived</span>
                      ) : out ? (
                        <span className="badge badge-danger">
                          <span className="dot" />
                          Out of stock
                        </span>
                      ) : low ? (
                        <span className="badge badge-warning">
                          <span className="dot" />
                          Low
                        </span>
                      ) : (
                        <span className="badge badge-success">
                          <span className="dot" />
                          In stock
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          className="btn btn-ghost btn-icon"
                          title="Edit product"
                          onClick={() => openEdit(p)}
                        >
                          <Icon name="edit" size={15} />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          title="Adjust stock"
                          onClick={() => setAdjustTarget(p)}
                          disabled={p.archived}
                        >
                          <Icon name="sliders" size={15} />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          title={p.archived ? "Restore" : "Archive"}
                          onClick={() => setArchiveTarget(p)}
                        >
                          <Icon name="archive" size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit product" : "New product"}
        subtitle={draft?.id ? "Changes apply to new sales immediately" : "Add a single item to the catalog"}
        size="medium"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={saveDraft} disabled={saving}>
              {saving ? <span className="spinner" /> : <Icon name="check" size={15} />}
              {draft?.id ? "Save changes" : "Add product"}
            </button>
          </>
        }
      >
        {draft && (
          <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
            <div className="field">
              <label>Product name</label>
              <input
                className={`input ${draftErrors.name ? "invalid" : ""}`}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Basmati Rice 1kg"
                autoFocus
              />
              {draftErrors.name && <span className="error">{draftErrors.name}</span>}
            </div>
            <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="field">
                <label>SKU</label>
                <input
                  className="input mono"
                  value={draft.sku}
                  onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                  placeholder="Auto-generated if empty"
                />
              </div>
              <div className="field">
                <label>Category</label>
                <input
                  className={`input ${draftErrors.category ? "invalid" : ""}`}
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  placeholder="Grocery"
                  list="category-list"
                />
                <datalist id="category-list">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                {draftErrors.category && <span className="error">{draftErrors.category}</span>}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <div className="field">
                <label>Unit</label>
                <input
                  className={`input ${draftErrors.unit ? "invalid" : ""}`}
                  value={draft.unit}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  placeholder="pc / kg / bottle"
                />
              </div>
              <div className="field">
                <label>Selling price ({currency})</label>
                <input
                  className={`input ${draftErrors.price ? "invalid" : ""}`}
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  placeholder="0.00"
                />
                {draftErrors.price && <span className="error">{draftErrors.price}</span>}
              </div>
              <div className="field">
                <label>Cost ({currency})</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.cost}
                  onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="field">
                <label>Stock on hand</label>
                <input
                  className={`input ${draftErrors.stock ? "invalid" : ""}`}
                  inputMode="decimal"
                  value={draft.stock}
                  onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
                />
                {draftErrors.stock && <span className="error">{draftErrors.stock}</span>}
              </div>
              <div className="field">
                <label>Low stock threshold</label>
                <input
                  className={`input ${draftErrors.reorder_level ? "invalid" : ""}`}
                  inputMode="decimal"
                  value={draft.reorder_level}
                  onChange={(e) => setDraft({ ...draft, reorder_level: e.target.value })}
                />
                {draftErrors.reorder_level && (
                  <span className="error">{draftErrors.reorder_level}</span>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <AdjustModal
        product={adjustTarget}
        currency={currency}
        onClose={() => setAdjustTarget(null)}
        onDone={() => {
          setAdjustTarget(null);
          load();
        }}
      />

      <Modal
        open={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        title={archiveTarget?.archived ? "Restore product?" : "Archive product?"}
        size="narrow"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setArchiveTarget(null)}>
              Cancel
            </button>
            <button
              className={`btn ${archiveTarget?.archived ? "btn-primary" : "btn-danger"}`}
              onClick={() => archiveTarget && archiveToggle(archiveTarget)}
            >
              {archiveTarget?.archived ? "Restore" : "Archive"}
            </button>
          </>
        }
      >
        <p className="muted">
          {archiveTarget?.archived
            ? `${archiveTarget?.name} will show up on the sale screen again.`
            : `${archiveTarget?.name} will be hidden from the sale screen. Past receipts keep the item.`}
        </p>
      </Modal>
    </div>
  );
}

function AdjustModal({
  product,
  currency,
  onClose,
  onDone,
}: {
  product: Product | null;
  currency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDelta("");
    setReason("");
  }, [product]);

  const submit = async () => {
    if (!product) return;
    const value = Number.parseFloat(delta);
    if (!Number.isFinite(value) || value === 0) {
      toastError("Enter a non-zero adjustment, e.g. +6 or -2");
      return;
    }
    setBusy(true);
    try {
      await PosService.AdjustStock({ product_id: product.id, delta: value, reason });
      toastSuccess(`${product.name} stock updated`);
      onDone();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={product !== null}
      onClose={onClose}
      title="Adjust stock"
      subtitle={product ? `${product.name} · currently ${formatQty(product.stock)} ${product.unit}` : ""}
      size="narrow"
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={15} />}
            Apply
          </button>
        </>
      }
    >
      {product && (
        <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
          <div className="detail-grid" style={{ marginBottom: 0 }}>
            <div className="detail-cell">
              <div className="dc-k">Value</div>
              <div className="dc-v">{formatMoney(product.price_cents, currency)}</div>
            </div>
            <div className="detail-cell">
              <div className="dc-k">Reorder at</div>
              <div className="dc-v">{formatQty(product.reorder_level)}</div>
            </div>
          </div>
          <div className="field">
            <label>Adjustment (use a negative number to remove stock)</label>
            <input
              className="input mono"
              inputMode="decimal"
              autoFocus
              placeholder="+6 or -2"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Reason</label>
            <input
              className="input"
              placeholder="Delivery, damage, stock count…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
