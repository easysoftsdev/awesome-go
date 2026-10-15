package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := openStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("openStore: %v", err)
	}
	if err := store.Init(); err != nil {
		t.Fatalf("Init: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func testContext() SaleContext {
	return SaleContext{
		WarehouseName: "Main Warehouse",
		WarehouseLoc:  "Dhaka",
		Counter:       "Counter 1",
		Cashier:       "Tester",
		AppVersion:    "test",
	}
}

func TestSeedIsIdempotent(t *testing.T) {
	store := newTestStore(t)

	first, err := store.EnsureSeedData()
	if err != nil {
		t.Fatalf("first seed: %v", err)
	}
	if !strings.Contains(first, "Seeded") {
		t.Fatalf("expected a seeding message, got %q", first)
	}
	count, err := store.CountProducts()
	if err != nil {
		t.Fatalf("CountProducts: %v", err)
	}
	if count != len(seedCatalog) {
		t.Fatalf("expected %d products, got %d", len(seedCatalog), count)
	}

	second, err := store.EnsureSeedData()
	if err != nil {
		t.Fatalf("second seed: %v", err)
	}
	if !strings.Contains(second, "already contains") {
		t.Fatalf("expected idempotent seed message, got %q", second)
	}
}

func TestProductSearchAndFilters(t *testing.T) {
	store := newTestStore(t)
	if _, err := store.EnsureSeedData(); err != nil {
		t.Fatal(err)
	}

	all, err := store.ListProducts(ProductFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != len(seedCatalog) {
		t.Fatalf("expected all products, got %d", len(all))
	}

	snacks, err := store.ListProducts(ProductFilter{Category: "Snacks"})
	if err != nil {
		t.Fatal(err)
	}
	if len(snacks) == 0 {
		t.Fatal("expected snack products")
	}
	for _, p := range snacks {
		if p.Category != "Snacks" {
			t.Fatalf("category filter leaked %q", p.Category)
		}
	}

	search, err := store.ListProducts(ProductFilter{Query: "rice"})
	if err != nil {
		t.Fatal(err)
	}
	if len(search) < 2 {
		t.Fatalf("expected rice matches, got %d", len(search))
	}

	low, err := store.ListProducts(ProductFilter{LowStockOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(low) == 0 {
		t.Fatal("expected at least one low stock product")
	}
	for _, p := range low {
		if p.Stock > p.ReorderLevel {
			t.Fatalf("%s is not low stock (stock %g, reorder %g)", p.Name, p.Stock, p.ReorderLevel)
		}
	}
}

func TestCheckoutMathAndStock(t *testing.T) {
	store := newTestStore(t)
	if _, err := store.EnsureSeedData(); err != nil {
		t.Fatal(err)
	}

	products, err := store.ListProducts(ProductFilter{Query: "Basmati Rice"})
	if err != nil {
		t.Fatal(err)
	}
	rice := products[0]
	products, err = store.ListProducts(ProductFilter{Query: "Cola 500ml"})
	if err != nil {
		t.Fatal(err)
	}
	cola := products[0]

	before := rice.Stock
	result, err := store.Checkout(CheckoutRequest{
		Lines: []CartLine{
			{ProductID: rice.ID, Qty: 3},
			{ProductID: cola.ID, Qty: 2},
			{ProductID: rice.ID, Qty: 1},
		},
		PaymentMethod:   "cash",
		AmountPaidCents: 2000,
	}, testContext())
	if err != nil {
		t.Fatalf("Checkout: %v", err)
	}

	wantSubtotal := int64(4*rice.PriceCents + 2*cola.PriceCents)
	if result.Sale.SubtotalCents != wantSubtotal {
		t.Fatalf("subtotal = %d, want %d", result.Sale.SubtotalCents, wantSubtotal)
	}
	if result.Sale.TotalCents != wantSubtotal {
		t.Fatalf("total = %d, want %d", result.Sale.TotalCents, wantSubtotal)
	}
	if result.Sale.ChangeCents != 2000-wantSubtotal {
		t.Fatalf("change = %d, want %d", result.Sale.ChangeCents, 2000-wantSubtotal)
	}
	if result.Sale.ItemCount != 2 {
		t.Fatalf("item count = %d, want 2 (duplicate lines must merge)", result.Sale.ItemCount)
	}
	if !strings.HasSuffix(result.Sale.ID, "-0001") {
		t.Fatalf("first receipt id should end with -0001, got %s", result.Sale.ID)
	}

	after, err := store.GetProduct(rice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Stock != before-4 {
		t.Fatalf("stock = %g, want %g", after.Stock, before-4)
	}

	pending, _, err := store.OutboxCounts()
	if err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatalf("pending outbox = %d, want 1", pending)
	}

	sales, err := store.GetSales(SalesFilter{Range: "today"})
	if err != nil {
		t.Fatal(err)
	}
	if len(sales) != 1 || sales[0].ID != result.Sale.ID {
		t.Fatalf("expected the new sale in today's list, got %+v", sales)
	}

	loaded, err := store.GetSale(result.Sale.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Items) != 2 {
		t.Fatalf("expected 2 stored line items, got %d", len(loaded.Items))
	}
	if loaded.Items[0].ProductID != rice.ID || loaded.Items[0].Qty != 4 {
		t.Fatalf("expected merged rice line with qty 4, got %+v", loaded.Items[0])
	}
}

func TestCheckoutRejectsBadInput(t *testing.T) {
	store := newTestStore(t)
	if _, err := store.EnsureSeedData(); err != nil {
		t.Fatal(err)
	}
	products, err := store.ListProducts(ProductFilter{Query: "Ghee"})
	if err != nil {
		t.Fatal(err)
	}
	ghee := products[0]

	if _, err := store.Checkout(CheckoutRequest{}, testContext()); err == nil {
		t.Fatal("empty cart must fail")
	}
	if _, err := store.Checkout(CheckoutRequest{
		Lines: []CartLine{{ProductID: ghee.ID, Qty: ghee.Stock + 1}},
	}, testContext()); err == nil || !strings.Contains(err.Error(), "insufficient stock") {
		t.Fatalf("expected insufficient stock error, got %v", err)
	}
	if _, err := store.Checkout(CheckoutRequest{
		Lines:         []CartLine{{ProductID: ghee.ID, Qty: 1}},
		DiscountCents: ghee.PriceCents + 1,
	}, testContext()); err == nil || !strings.Contains(err.Error(), "discount") {
		t.Fatalf("expected discount error, got %v", err)
	}
	if _, err := store.Checkout(CheckoutRequest{
		Lines:           []CartLine{{ProductID: ghee.ID, Qty: 1}},
		AmountPaidCents: 1,
	}, testContext()); err == nil || !strings.Contains(err.Error(), "less than the total") {
		t.Fatalf("expected payment error, got %v", err)
	}
}

func TestVoidRestoresStock(t *testing.T) {
	store := newTestStore(t)
	if _, err := store.EnsureSeedData(); err != nil {
		t.Fatal(err)
	}
	products, err := store.ListProducts(ProductFilter{Query: "Bread Loaf"})
	if err != nil {
		t.Fatal(err)
	}
	bread := products[0]

	result, err := store.Checkout(CheckoutRequest{
		Lines:         []CartLine{{ProductID: bread.ID, Qty: 2}},
		PaymentMethod: "cash",
	}, testContext())
	if err != nil {
		t.Fatal(err)
	}
	mid, err := store.GetProduct(bread.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mid.Stock != bread.Stock-2 {
		t.Fatalf("stock after sale = %g, want %g", mid.Stock, bread.Stock-2)
	}

	if err := store.VoidSale(result.Sale.ID, "customer changed mind"); err != nil {
		t.Fatalf("VoidSale: %v", err)
	}
	final, err := store.GetProduct(bread.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.Stock != bread.Stock {
		t.Fatalf("stock after void = %g, want %g", final.Stock, bread.Stock)
	}
	sale, err := store.GetSale(result.Sale.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sale.Status != saleStatusVoided {
		t.Fatalf("status = %q, want %q", sale.Status, saleStatusVoided)
	}
	if err := store.VoidSale(result.Sale.ID, "again"); err == nil {
		t.Fatal("voiding twice must fail")
	}
}

func TestSaveProductAndDuplicates(t *testing.T) {
	store := newTestStore(t)

	created, err := store.SaveProduct(Product{
		Name: "Test Widget", Category: "Test", Unit: "pc",
		PriceCents: 999, CostCents: 500, Stock: 10, ReorderLevel: 3,
	})
	if err != nil {
		t.Fatalf("SaveProduct: %v", err)
	}
	if created.ID == 0 || created.SKU == "" {
		t.Fatalf("expected id and sku, got %+v", created)
	}
	if created.Stock != 10 {
		t.Fatalf("stock = %g", created.Stock)
	}

	if _, err := store.SaveProduct(Product{
		SKU: created.SKU, Name: "Clash", Category: "Test", Unit: "pc", PriceCents: 100,
	}); err == nil || !strings.Contains(err.Error(), "already used") {
		t.Fatalf("expected duplicate SKU error, got %v", err)
	}

	created.PriceCents = 1200
	created.Stock = 7
	updated, err := store.SaveProduct(created)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.PriceCents != 1200 || updated.Stock != 7 {
		t.Fatalf("update not applied: %+v", updated)
	}

	adjusted, err := store.AdjustStock(StockAdjustment{ProductID: created.ID, Delta: -5, Reason: "damage"})
	if err != nil {
		t.Fatal(err)
	}
	if adjusted.Stock != 2 {
		t.Fatalf("stock after adjustment = %g, want 2", adjusted.Stock)
	}
	if _, err := store.AdjustStock(StockAdjustment{ProductID: created.ID, Delta: -5}); err == nil {
		t.Fatal("stock cannot go negative")
	}

	if err := store.ArchiveProduct(created.ID, true); err != nil {
		t.Fatal(err)
	}
	visible, err := store.ListProducts(ProductFilter{Query: "Test Widget"})
	if err != nil {
		t.Fatal(err)
	}
	if len(visible) != 0 {
		t.Fatalf("archived product still visible: %+v", visible)
	}
}

func TestDashboard(t *testing.T) {
	store := newTestStore(t)
	if _, err := store.EnsureSeedData(); err != nil {
		t.Fatal(err)
	}
	products, err := store.ListProducts(ProductFilter{Query: "Cola"})
	if err != nil {
		t.Fatal(err)
	}
	cola := products[0]

	if _, err := store.Checkout(CheckoutRequest{
		Lines:         []CartLine{{ProductID: cola.ID, Qty: 4}},
		PaymentMethod: "cash",
	}, testContext()); err != nil {
		t.Fatal(err)
	}

	dash, err := store.GetDashboard()
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	if dash.TodayTransactions != 1 {
		t.Fatalf("transactions = %d, want 1", dash.TodayTransactions)
	}
	if dash.TodayRevenueCents != 4*cola.PriceCents {
		t.Fatalf("revenue = %d, want %d", dash.TodayRevenueCents, 4*cola.PriceCents)
	}
	if dash.TodayProfitCents != 4*(cola.PriceCents-cola.CostCents) {
		t.Fatalf("profit = %d, want %d", dash.TodayProfitCents, 4*(cola.PriceCents-cola.CostCents))
	}
	if len(dash.Week) != 7 {
		t.Fatalf("week buckets = %d, want 7", len(dash.Week))
	}
	if len(dash.TopProducts) == 0 || dash.TopProducts[0].ProductID != cola.ID {
		t.Fatalf("expected cola as top product, got %+v", dash.TopProducts)
	}
	if dash.ProductCount != len(seedCatalog) {
		t.Fatalf("product count = %d", dash.ProductCount)
	}
	if dash.PendingSync != 1 {
		t.Fatalf("pending sync = %d, want 1", dash.PendingSync)
	}
}
