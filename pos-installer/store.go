package main

import (
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const (
	saleStatusCompleted = "completed"
	saleStatusVoided    = "voided"

	syncStatePending = "pending"
	syncStateSynced  = "synced"
)

type Product struct {
	ID           int64   `json:"id"`
	SKU          string  `json:"sku"`
	Name         string  `json:"name"`
	Category     string  `json:"category"`
	Unit         string  `json:"unit"`
	PriceCents   int64   `json:"price_cents"`
	CostCents    int64   `json:"cost_cents"`
	Stock        float64 `json:"stock"`
	ReorderLevel float64 `json:"reorder_level"`
	Archived     bool    `json:"archived"`
	UpdatedAt    string  `json:"updated_at"`
}

type ProductFilter struct {
	Query          string `json:"query"`
	Category       string `json:"category"`
	IncludeArchived bool  `json:"include_archived"`
	LowStockOnly   bool   `json:"low_stock_only"`
}

type StockAdjustment struct {
	ProductID int64   `json:"product_id"`
	Delta     float64 `json:"delta"`
	Reason    string  `json:"reason"`
}

type CartLine struct {
	ProductID int64   `json:"product_id"`
	Qty       float64 `json:"qty"`
}

type CheckoutRequest struct {
	Lines           []CartLine `json:"lines"`
	PaymentMethod   string     `json:"payment_method"`
	AmountPaidCents int64      `json:"amount_paid_cents"`
	DiscountCents   int64      `json:"discount_cents"`
	Customer        string     `json:"customer"`
	Note            string     `json:"note"`
}

type SaleItem struct {
	ProductID      int64   `json:"product_id"`
	SKU            string  `json:"sku"`
	Name           string  `json:"name"`
	Unit           string  `json:"unit"`
	UnitPriceCents int64   `json:"unit_price_cents"`
	Qty            float64 `json:"qty"`
	LineTotalCents int64   `json:"line_total_cents"`
}

type Sale struct {
	ID              string     `json:"id"`
	CreatedAt       string     `json:"created_at"`
	Counter         string     `json:"counter"`
	Cashier         string     `json:"cashier"`
	Customer        string     `json:"customer"`
	PaymentMethod   string     `json:"payment_method"`
	SubtotalCents   int64      `json:"subtotal_cents"`
	DiscountCents   int64      `json:"discount_cents"`
	TotalCents      int64      `json:"total_cents"`
	AmountPaidCents int64      `json:"amount_paid_cents"`
	ChangeCents     int64      `json:"change_cents"`
	Status          string     `json:"status"`
	SyncState       string     `json:"sync_state"`
	Note            string     `json:"note"`
	ItemCount       int        `json:"item_count"`
	Items           []SaleItem `json:"items"`
}

type SaleSummary struct {
	ID              string  `json:"id"`
	CreatedAt       string  `json:"created_at"`
	Customer        string  `json:"customer"`
	Counter         string  `json:"counter"`
	Cashier         string  `json:"cashier"`
	PaymentMethod   string  `json:"payment_method"`
	SubtotalCents   int64   `json:"subtotal_cents"`
	DiscountCents   int64   `json:"discount_cents"`
	TotalCents      int64   `json:"total_cents"`
	ChangeCents     int64   `json:"change_cents"`
	Status          string  `json:"status"`
	SyncState       string  `json:"sync_state"`
	ItemCount       int     `json:"item_count"`
	FirstItemName   string  `json:"first_item_name"`
}

type SalesFilter struct {
	Range string `json:"range"`
	Query string `json:"query"`
	Limit int    `json:"limit"`
}

type CheckoutResult struct {
	Sale     Sale     `json:"sale"`
	Warnings []string `json:"warnings"`
}

type SaleContext struct {
	WarehouseName string
	WarehouseLoc  string
	Counter       string
	Cashier       string
	AppVersion    string
}

type DayStat struct {
	Date           string `json:"date"`
	RevenueCents   int64  `json:"revenue_cents"`
	Transactions   int    `json:"transactions"`
}

type TopProduct struct {
	ProductID     int64   `json:"product_id"`
	Name          string  `json:"name"`
	Qty           float64 `json:"qty"`
	RevenueCents  int64   `json:"revenue_cents"`
}

type Dashboard struct {
	RangeStart          string       `json:"range_start"`
	TodayRevenueCents   int64        `json:"today_revenue_cents"`
	TodayProfitCents    int64        `json:"today_profit_cents"`
	TodayTransactions   int          `json:"today_transactions"`
	TodayItems          float64      `json:"today_items"`
	AvgBasketCents      int64        `json:"avg_basket_cents"`
	Week                []DayStat    `json:"week"`
	TopProducts         []TopProduct `json:"top_products"`
	LowStock            []Product    `json:"low_stock"`
	ProductCount        int          `json:"product_count"`
	PendingSync         int          `json:"pending_sync"`
}

type OutboxRow struct {
	ID        int64  `json:"id"`
	SaleID    string `json:"sale_id"`
	Payload   string `json:"payload"`
	Attempts  int    `json:"attempts"`
	LastError string `json:"last_error"`
	State     string `json:"state"`
	CreatedAt string `json:"created_at"`
}

type Store struct {
	db   *sql.DB
	path string
	mu   sync.Mutex
}

var seedCatalog = []Product{
	{SKU: "RIC-001", Name: "Premium Rice 5kg", Category: "Grocery", Unit: "bag", PriceCents: 1250, CostCents: 940, Stock: 42, ReorderLevel: 10},
	{SKU: "RIC-002", Name: "Basmati Rice 1kg", Category: "Grocery", Unit: "pack", PriceCents: 320, CostCents: 245, Stock: 60, ReorderLevel: 12},
	{SKU: "SUG-001", Name: "Sugar 1kg", Category: "Grocery", Unit: "pack", PriceCents: 135, CostCents: 105, Stock: 80, ReorderLevel: 15},
	{SKU: "FLO-001", Name: "Wheat Flour 2kg", Category: "Grocery", Unit: "pack", PriceCents: 210, CostCents: 160, Stock: 48, ReorderLevel: 10},
	{SKU: "SAL-001", Name: "Iodized Salt 1kg", Category: "Grocery", Unit: "pack", PriceCents: 60, CostCents: 40, Stock: 70, ReorderLevel: 12},
	{SKU: "OIL-001", Name: "Cooking Oil 1L", Category: "Grocery", Unit: "bottle", PriceCents: 340, CostCents: 275, Stock: 36, ReorderLevel: 10},
	{SKU: "OIL-002", Name: "Mustard Oil 1L", Category: "Grocery", Unit: "bottle", PriceCents: 420, CostCents: 340, Stock: 24, ReorderLevel: 8},
	{SKU: "LEN-001", Name: "Red Lentils 1kg", Category: "Grocery", Unit: "pack", PriceCents: 260, CostCents: 205, Stock: 30, ReorderLevel: 8},
	{SKU: "CHK-001", Name: "Chickpeas 1kg", Category: "Grocery", Unit: "pack", PriceCents: 240, CostCents: 185, Stock: 26, ReorderLevel: 8},
	{SKU: "SPI-001", Name: "Mixed Spice 200g", Category: "Grocery", Unit: "pack", PriceCents: 180, CostCents: 130, Stock: 18, ReorderLevel: 6},
	{SKU: "TEA-001", Name: "Tea Bags 100pc", Category: "Beverages", Unit: "box", PriceCents: 450, CostCents: 340, Stock: 8, ReorderLevel: 12},
	{SKU: "COF-001", Name: "Instant Coffee 50g", Category: "Beverages", Unit: "jar", PriceCents: 520, CostCents: 400, Stock: 20, ReorderLevel: 6},
	{SKU: "WAT-001", Name: "Mineral Water 1L", Category: "Beverages", Unit: "bottle", PriceCents: 55, CostCents: 35, Stock: 96, ReorderLevel: 24},
	{SKU: "COL-001", Name: "Cola 500ml", Category: "Beverages", Unit: "bottle", PriceCents: 80, CostCents: 55, Stock: 72, ReorderLevel: 18},
	{SKU: "JUI-001", Name: "Orange Juice 1L", Category: "Beverages", Unit: "carton", PriceCents: 260, CostCents: 195, Stock: 30, ReorderLevel: 8},
	{SKU: "ENG-001", Name: "Energy Drink 250ml", Category: "Beverages", Unit: "can", PriceCents: 150, CostCents: 110, Stock: 40, ReorderLevel: 10},
	{SKU: "SNK-001", Name: "Potato Chips 100g", Category: "Snacks", Unit: "pack", PriceCents: 120, CostCents: 85, Stock: 54, ReorderLevel: 12},
	{SKU: "SNK-002", Name: "Chocolate Bar 45g", Category: "Snacks", Unit: "bar", PriceCents: 140, CostCents: 100, Stock: 60, ReorderLevel: 15},
	{SKU: "SNK-003", Name: "Biscuits Pack", Category: "Snacks", Unit: "pack", PriceCents: 90, CostCents: 62, Stock: 66, ReorderLevel: 15},
	{SKU: "SNK-004", Name: "Salted Peanuts 200g", Category: "Snacks", Unit: "pack", PriceCents: 170, CostCents: 125, Stock: 22, ReorderLevel: 8},
	{SKU: "SNK-005", Name: "Cream Crackers 250g", Category: "Snacks", Unit: "pack", PriceCents: 160, CostCents: 118, Stock: 28, ReorderLevel: 8},
	{SKU: "DRY-001", Name: "Fresh Milk 1L", Category: "Dairy", Unit: "bottle", PriceCents: 190, CostCents: 155, Stock: 34, ReorderLevel: 10},
	{SKU: "DRY-002", Name: "Yogurt 500g", Category: "Dairy", Unit: "cup", PriceCents: 150, CostCents: 115, Stock: 20, ReorderLevel: 8},
	{SKU: "DRY-003", Name: "Butter 200g", Category: "Dairy", Unit: "pack", PriceCents: 480, CostCents: 380, Stock: 14, ReorderLevel: 6},
	{SKU: "DRY-004", Name: "Cheese Slices 10pc", Category: "Dairy", Unit: "pack", PriceCents: 350, CostCents: 270, Stock: 16, ReorderLevel: 6},
	{SKU: "DRY-005", Name: "Ghee 250ml", Category: "Dairy", Unit: "jar", PriceCents: 690, CostCents: 560, Stock: 12, ReorderLevel: 5},
	{SKU: "BAK-001", Name: "Bread Loaf", Category: "Bakery", Unit: "loaf", PriceCents: 110, CostCents: 78, Stock: 25, ReorderLevel: 10},
	{SKU: "BAK-002", Name: "Buns 6pc", Category: "Bakery", Unit: "pack", PriceCents: 130, CostCents: 92, Stock: 18, ReorderLevel: 8},
	{SKU: "BAK-003", Name: "Fresh Eggs 12pc", Category: "Bakery", Unit: "tray", PriceCents: 260, CostCents: 210, Stock: 30, ReorderLevel: 10},
	{SKU: "HHD-001", Name: "Dish Soap 500ml", Category: "Household", Unit: "bottle", PriceCents: 220, CostCents: 165, Stock: 26, ReorderLevel: 8},
	{SKU: "HHD-002", Name: "Laundry Powder 1kg", Category: "Household", Unit: "pack", PriceCents: 380, CostCents: 295, Stock: 22, ReorderLevel: 8},
	{SKU: "HHD-003", Name: "Trash Bags 30pc", Category: "Household", Unit: "roll", PriceCents: 175, CostCents: 128, Stock: 19, ReorderLevel: 6},
	{SKU: "HHD-004", Name: "Floor Cleaner 1L", Category: "Household", Unit: "bottle", PriceCents: 290, CostCents: 220, Stock: 15, ReorderLevel: 6},
	{SKU: "PCR-001", Name: "Shampoo 200ml", Category: "Personal Care", Unit: "bottle", PriceCents: 420, CostCents: 325, Stock: 18, ReorderLevel: 6},
	{SKU: "PCR-002", Name: "Toothpaste 100g", Category: "Personal Care", Unit: "tube", PriceCents: 240, CostCents: 180, Stock: 24, ReorderLevel: 8},
	{SKU: "PCR-003", Name: "Hand Sanitizer 250ml", Category: "Personal Care", Unit: "bottle", PriceCents: 260, CostCents: 195, Stock: 3, ReorderLevel: 8},
	{SKU: "PCR-004", Name: "Tissue Box", Category: "Personal Care", Unit: "box", PriceCents: 190, CostCents: 140, Stock: 32, ReorderLevel: 10},
	{SKU: "PCR-005", Name: "Bath Soap 100g", Category: "Personal Care", Unit: "bar", PriceCents: 85, CostCents: 58, Stock: 48, ReorderLevel: 12},
}

var schemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sku TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT 'General',
		unit TEXT NOT NULL DEFAULT 'pc',
		price_cents INTEGER NOT NULL DEFAULT 0,
		cost_cents INTEGER NOT NULL DEFAULT 0,
		stock REAL NOT NULL DEFAULT 0,
		reorder_level REAL NOT NULL DEFAULT 5,
		archived INTEGER NOT NULL DEFAULT 0,
		updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS sales (
		id TEXT PRIMARY KEY,
		created_at TEXT NOT NULL,
		counter TEXT NOT NULL DEFAULT '',
		cashier TEXT NOT NULL DEFAULT '',
		customer TEXT NOT NULL DEFAULT '',
		payment_method TEXT NOT NULL DEFAULT 'cash',
		subtotal_cents INTEGER NOT NULL DEFAULT 0,
		discount_cents INTEGER NOT NULL DEFAULT 0,
		total_cents INTEGER NOT NULL DEFAULT 0,
		amount_paid_cents INTEGER NOT NULL DEFAULT 0,
		change_cents INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'completed',
		sync_state TEXT NOT NULL DEFAULT 'pending',
		note TEXT NOT NULL DEFAULT ''
	)`,
	`CREATE TABLE IF NOT EXISTS sale_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
		product_id INTEGER NOT NULL,
		sku TEXT NOT NULL DEFAULT '',
		name TEXT NOT NULL,
		unit TEXT NOT NULL DEFAULT '',
		unit_price_cents INTEGER NOT NULL DEFAULT 0,
		qty REAL NOT NULL DEFAULT 1,
		line_total_cents INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id)`,
	`CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at)`,
	`CREATE TABLE IF NOT EXISTS stock_moves (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL,
		delta REAL NOT NULL,
		reason TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS outbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sale_id TEXT NOT NULL UNIQUE,
		payload TEXT NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0,
		last_error TEXT NOT NULL DEFAULT '',
		state TEXT NOT NULL DEFAULT 'pending',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT '',
		sent_at TEXT NOT NULL DEFAULT ''
	)`,
}

func openStore(path string) (*Store, error) {
	dsn := fmt.Sprintf(
		"file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(8000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)",
		path,
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("cannot open database: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("database is not reachable: %w", err)
	}
	return &Store{db: db, path: path}, nil
}

func (st *Store) Init() error {
	for _, stmt := range schemaStatements {
		if _, err := st.db.Exec(stmt); err != nil {
			return fmt.Errorf("cannot prepare database schema: %w", err)
		}
	}
	return nil
}

func (st *Store) Close() error {
	if st == nil || st.db == nil {
		return nil
	}
	return st.db.Close()
}

func (st *Store) EnsureSeedData() (string, error) {
	var total int
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM products`).Scan(&total); err != nil {
		return "", err
	}
	if total > 0 {
		return fmt.Sprintf("Catalog already contains %d products", total), nil
	}
	tx, err := st.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339)
	cats := map[string]bool{}
	for _, p := range seedCatalog {
		if _, err := tx.Exec(
			`INSERT INTO products (sku, name, category, unit, price_cents, cost_cents, stock, reorder_level, archived, updated_at)
			 VALUES (?,?,?,?,?,?,?,?,0,?)`,
			p.SKU, p.Name, p.Category, p.Unit, p.PriceCents, p.CostCents, p.Stock, p.ReorderLevel, now,
		); err != nil {
			return "", fmt.Errorf("cannot seed product %s: %w", p.SKU, err)
		}
		cats[p.Category] = true
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return fmt.Sprintf("Seeded %d products across %d categories", len(seedCatalog), len(cats)), nil
}

func (st *Store) CountProducts() (int, error) {
	var n int
	err := st.db.QueryRow(`SELECT COUNT(*) FROM products WHERE archived = 0`).Scan(&n)
	return n, err
}

func scanProduct(scan func(dest ...any) error) (Product, error) {
	var p Product
	var archived int
	err := scan(&p.ID, &p.SKU, &p.Name, &p.Category, &p.Unit, &p.PriceCents, &p.CostCents,
		&p.Stock, &p.ReorderLevel, &archived, &p.UpdatedAt)
	p.Archived = archived != 0
	return p, err
}

const productColumns = `id, sku, name, category, unit, price_cents, cost_cents, stock, reorder_level, archived, updated_at`

func (st *Store) ListProducts(f ProductFilter) ([]Product, error) {
	query := `SELECT ` + productColumns + ` FROM products WHERE 1=1`
	args := []any{}
	if !f.IncludeArchived {
		query += ` AND archived = 0`
	}
	if f.Category != "" && f.Category != "All" {
		query += ` AND category = ?`
		args = append(args, f.Category)
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		like := "%" + q + "%"
		query += ` AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)`
		args = append(args, like, like, like)
	}
	if f.LowStockOnly {
		query += ` AND stock <= reorder_level`
	}
	query += ` ORDER BY archived ASC, category, name`

	rows, err := st.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	products := []Product{}
	for rows.Next() {
		p, err := scanProduct(rows.Scan)
		if err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

func (st *Store) GetProduct(id int64) (Product, error) {
	row := st.db.QueryRow(`SELECT `+productColumns+` FROM products WHERE id = ?`, id)
	return scanProduct(row.Scan)
}

func (st *Store) GetCategories() ([]string, error) {
	rows, err := st.db.Query(`SELECT DISTINCT category FROM products WHERE archived = 0 ORDER BY category`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cats := []string{}
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		cats = append(cats, c)
	}
	return cats, rows.Err()
}

func validateProduct(p Product) error {
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("product name is required")
	}
	if strings.TrimSpace(p.Category) == "" {
		return fmt.Errorf("category is required")
	}
	if strings.TrimSpace(p.Unit) == "" {
		return fmt.Errorf("unit is required")
	}
	if p.PriceCents < 0 {
		return fmt.Errorf("price cannot be negative")
	}
	if p.CostCents < 0 {
		return fmt.Errorf("cost cannot be negative")
	}
	if p.Stock < 0 {
		return fmt.Errorf("stock cannot be negative")
	}
	if p.ReorderLevel < 0 {
		return fmt.Errorf("reorder level cannot be negative")
	}
	return nil
}

func (st *Store) SaveProduct(p Product) (Product, error) {
	p.Name = strings.TrimSpace(p.Name)
	p.Category = strings.TrimSpace(p.Category)
	p.Unit = strings.TrimSpace(p.Unit)
	p.SKU = strings.TrimSpace(p.SKU)
	if err := validateProduct(p); err != nil {
		return Product{}, err
	}
	if p.SKU == "" {
		p.SKU = generateSKU(p.Name)
	}

	st.mu.Lock()
	defer st.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	if p.ID > 0 {
		existing, err := st.GetProduct(p.ID)
		if err != nil {
			return Product{}, fmt.Errorf("product not found: %d", p.ID)
		}
		if existing.Stock != p.Stock {
			if err := st.recordMove(p.ID, p.Stock-existing.Stock, "manual adjustment"); err != nil {
				return Product{}, err
			}
		}
		_, err = st.db.Exec(
			`UPDATE products SET sku=?, name=?, category=?, unit=?, price_cents=?, cost_cents=?, stock=?, reorder_level=?, archived=?, updated_at=? WHERE id=?`,
			p.SKU, p.Name, p.Category, p.Unit, p.PriceCents, p.CostCents, p.Stock, p.ReorderLevel, boolInt(p.Archived), now, p.ID,
		)
		if err != nil {
			return Product{}, normalizeSQLError(err, p.SKU)
		}
		return st.GetProduct(p.ID)
	}

	tx, err := st.db.Begin()
	if err != nil {
		return Product{}, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO products (sku, name, category, unit, price_cents, cost_cents, stock, reorder_level, archived, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		p.SKU, p.Name, p.Category, p.Unit, p.PriceCents, p.CostCents, p.Stock, p.ReorderLevel, boolInt(p.Archived), now,
	)
	if err != nil {
		return Product{}, normalizeSQLError(err, p.SKU)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Product{}, err
	}
	if p.Stock != 0 {
		if _, err := tx.Exec(
			`INSERT INTO stock_moves (product_id, delta, reason, created_at) VALUES (?,?,?,?)`,
			id, p.Stock, "initial stock", now,
		); err != nil {
			return Product{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Product{}, err
	}
	return st.GetProduct(id)
}

func (st *Store) AdjustStock(req StockAdjustment) (Product, error) {
	if req.ProductID == 0 {
		return Product{}, fmt.Errorf("product is required")
	}
	if req.Delta == 0 {
		return Product{}, fmt.Errorf("adjustment cannot be zero")
	}

	st.mu.Lock()
	defer st.mu.Unlock()

	product, err := st.GetProduct(req.ProductID)
	if err != nil {
		return Product{}, fmt.Errorf("product not found: %d", req.ProductID)
	}
	next := product.Stock + req.Delta
	if next < 0 {
		return Product{}, fmt.Errorf("stock would drop below zero (current stock: %g)", product.Stock)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	tx, err := st.db.Begin()
	if err != nil {
		return Product{}, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE products SET stock=?, updated_at=? WHERE id=?`, next, now, req.ProductID); err != nil {
		return Product{}, err
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "manual adjustment"
	}
	if _, err := tx.Exec(
		`INSERT INTO stock_moves (product_id, delta, reason, created_at) VALUES (?,?,?,?)`,
		req.ProductID, req.Delta, reason, now,
	); err != nil {
		return Product{}, err
	}
	if err := tx.Commit(); err != nil {
		return Product{}, err
	}
	return st.GetProduct(req.ProductID)
}

func (st *Store) ArchiveProduct(id int64, archived bool) error {
	if _, err := st.GetProduct(id); err != nil {
		return fmt.Errorf("product not found: %d", id)
	}
	_, err := st.db.Exec(
		`UPDATE products SET archived=?, updated_at=? WHERE id=?`,
		boolInt(archived), time.Now().UTC().Format(time.RFC3339), id,
	)
	return err
}

func (st *Store) recordMove(productID int64, delta float64, reason string) error {
	_, err := st.db.Exec(
		`INSERT INTO stock_moves (product_id, delta, reason, created_at) VALUES (?,?,?,?)`,
		productID, delta, reason, time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

func (st *Store) Checkout(req CheckoutRequest, ctx SaleContext) (CheckoutResult, error) {
	if len(req.Lines) == 0 {
		return CheckoutResult{}, fmt.Errorf("cart is empty")
	}

	merged := map[int64]float64{}
	order := []int64{}
	for _, line := range req.Lines {
		if line.ProductID == 0 {
			return CheckoutResult{}, fmt.Errorf("invalid cart line")
		}
		if line.Qty <= 0 {
			return CheckoutResult{}, fmt.Errorf("quantity must be greater than zero")
		}
		if _, seen := merged[line.ProductID]; !seen {
			order = append(order, line.ProductID)
		}
		merged[line.ProductID] += line.Qty
	}

	method := strings.ToLower(strings.TrimSpace(req.PaymentMethod))
	switch method {
	case "":
		method = "cash"
	case "cash", "card", "mobile", "credit":
	default:
		return CheckoutResult{}, fmt.Errorf("unknown payment method: %s", req.PaymentMethod)
	}
	if strings.TrimSpace(req.Customer) == "" {
		req.Customer = "Walk-in"
	}

	st.mu.Lock()
	defer st.mu.Unlock()

	tx, err := st.db.Begin()
	if err != nil {
		return CheckoutResult{}, err
	}
	defer tx.Rollback()

	now := time.Now()
	createdAt := now.UTC().Format(time.RFC3339)

	items := []SaleItem{}
	subtotal := int64(0)
	for _, id := range order {
		qty := merged[id]
		var p Product
		var archived int
		err := tx.QueryRow(
			`SELECT id, sku, name, category, unit, price_cents, cost_cents, stock, reorder_level, archived, updated_at
			 FROM products WHERE id = ?`, id,
		).Scan(&p.ID, &p.SKU, &p.Name, &p.Category, &p.Unit, &p.PriceCents, &p.CostCents,
			&p.Stock, &p.ReorderLevel, &archived, &p.UpdatedAt)
		if err == sql.ErrNoRows {
			return CheckoutResult{}, fmt.Errorf("product %d is no longer available", id)
		}
		if err != nil {
			return CheckoutResult{}, err
		}
		if archived != 0 {
			return CheckoutResult{}, fmt.Errorf("%s is no longer sold", p.Name)
		}
		if p.Stock < qty {
			return CheckoutResult{}, fmt.Errorf("insufficient stock for %s (%g %s left)", p.Name, p.Stock, p.Unit)
		}

		lineTotal := roundCents(float64(qty) * float64(p.PriceCents))
		subtotal += lineTotal
		items = append(items, SaleItem{
			ProductID:      p.ID,
			SKU:            p.SKU,
			Name:           p.Name,
			Unit:           p.Unit,
			UnitPriceCents: p.PriceCents,
			Qty:            qty,
			LineTotalCents: lineTotal,
		})

		newStock := p.Stock - qty
		if _, err := tx.Exec(`UPDATE products SET stock=?, updated_at=? WHERE id=?`, newStock, createdAt, p.ID); err != nil {
			return CheckoutResult{}, err
		}
		if _, err := tx.Exec(
			`INSERT INTO stock_moves (product_id, delta, reason, created_at) VALUES (?,?,?,?)`,
			p.ID, -qty, "sale "+fmt.Sprint(now.Format("2006-01-02")), createdAt,
		); err != nil {
			return CheckoutResult{}, err
		}
	}

	discount := req.DiscountCents
	if discount < 0 {
		return CheckoutResult{}, fmt.Errorf("discount cannot be negative")
	}
	if discount > subtotal {
		return CheckoutResult{}, fmt.Errorf("discount cannot exceed the subtotal")
	}
	total := subtotal - discount

	amountPaid := req.AmountPaidCents
	if amountPaid == 0 {
		amountPaid = total
	}
	if amountPaid < total {
		return CheckoutResult{}, fmt.Errorf("amount received (%s) is less than the total (%s)",
			formatCents(amountPaid), formatCents(total))
	}
	change := amountPaid - total

	saleID, err := nextSaleID(tx, now)
	if err != nil {
		return CheckoutResult{}, err
	}

	sale := Sale{
		ID:              saleID,
		CreatedAt:       createdAt,
		Counter:         ctx.Counter,
		Cashier:         ctx.Cashier,
		Customer:        strings.TrimSpace(req.Customer),
		PaymentMethod:   method,
		SubtotalCents:   subtotal,
		DiscountCents:   discount,
		TotalCents:      total,
		AmountPaidCents: amountPaid,
		ChangeCents:     change,
		Status:          saleStatusCompleted,
		SyncState:       syncStatePending,
		Note:            strings.TrimSpace(req.Note),
		ItemCount:       len(items),
		Items:           items,
	}

	if _, err := tx.Exec(
		`INSERT INTO sales (id, created_at, counter, cashier, customer, payment_method, subtotal_cents, discount_cents,
			total_cents, amount_paid_cents, change_cents, status, sync_state, note)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		sale.ID, sale.CreatedAt, sale.Counter, sale.Cashier, sale.Customer, sale.PaymentMethod,
		sale.SubtotalCents, sale.DiscountCents, sale.TotalCents, sale.AmountPaidCents, sale.ChangeCents,
		sale.Status, sale.SyncState, sale.Note,
	); err != nil {
		return CheckoutResult{}, err
	}

	for _, item := range items {
		if _, err := tx.Exec(
			`INSERT INTO sale_items (sale_id, product_id, sku, name, unit, unit_price_cents, qty, line_total_cents)
			 VALUES (?,?,?,?,?,?,?,?)`,
			sale.ID, item.ProductID, item.SKU, item.Name, item.Unit, item.UnitPriceCents, item.Qty, item.LineTotalCents,
		); err != nil {
			return CheckoutResult{}, err
		}
	}

	payload, err := marshalOutboxPayload(ctx, sale)
	if err != nil {
		return CheckoutResult{}, err
	}
	if _, err := tx.Exec(
		`INSERT INTO outbox (sale_id, payload, attempts, last_error, state, created_at, updated_at)
		 VALUES (?,?,0,'',?,?,?)`,
		sale.ID, payload, syncStatePending, createdAt, createdAt,
	); err != nil {
		return CheckoutResult{}, err
	}

	if err := tx.Commit(); err != nil {
		return CheckoutResult{}, err
	}

	warnings := []string{}
	for _, item := range items {
		var stock, reorder float64
		if err := st.db.QueryRow(`SELECT stock, reorder_level FROM products WHERE id=?`, item.ProductID).
			Scan(&stock, &reorder); err == nil && stock <= reorder {
			warnings = append(warnings, fmt.Sprintf("%s is down to %g %s", item.Name, stock, item.Unit))
		}
	}

	return CheckoutResult{Sale: sale, Warnings: warnings}, nil
}

func nextSaleID(tx *sql.Tx, now time.Time) (string, error) {
	dayKey := now.Format("20060102")
	dayStart := startOfLocalDay(now).UTC().Format(time.RFC3339)
	for attempt := 0; attempt < 100; attempt++ {
		var count int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM sales WHERE created_at >= ?`, dayStart).Scan(&count); err != nil {
			return "", err
		}
		id := fmt.Sprintf("%s-%04d", dayKey, count+1+attempt)
		var exists int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM sales WHERE id = ?`, id).Scan(&exists); err != nil {
			return "", err
		}
		if exists == 0 {
			return id, nil
		}
	}
	return "", fmt.Errorf("could not allocate a receipt number")
}

func (st *Store) GetSales(f SalesFilter) ([]SaleSummary, error) {
	limit := f.Limit
	if limit <= 0 || limit > 1000 {
		limit = 200
	}

	query := `SELECT s.id, s.created_at, s.customer, s.counter, s.cashier, s.payment_method,
		s.subtotal_cents, s.discount_cents, s.total_cents, s.change_cents, s.status, s.sync_state,
		(SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
		COALESCE((SELECT si.name FROM sale_items si WHERE si.sale_id = s.id ORDER BY si.id LIMIT 1), '') AS first_item
		FROM sales s WHERE 1=1`
	args := []any{}

	if start, ok := rangeStart(f.Range); ok {
		query += ` AND s.created_at >= ?`
		args = append(args, start.UTC().Format(time.RFC3339))
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		like := "%" + q + "%"
		query += ` AND (s.id LIKE ? OR s.customer LIKE ? OR EXISTS (
			SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND (si.name LIKE ? OR si.sku LIKE ?)
		))`
		args = append(args, like, like, like, like)
	}
	query += ` ORDER BY s.created_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := st.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sales := []SaleSummary{}
	for rows.Next() {
		var s SaleSummary
		if err := rows.Scan(&s.ID, &s.CreatedAt, &s.Customer, &s.Counter, &s.Cashier, &s.PaymentMethod,
			&s.SubtotalCents, &s.DiscountCents, &s.TotalCents, &s.ChangeCents, &s.Status, &s.SyncState,
			&s.ItemCount, &s.FirstItemName); err != nil {
			return nil, err
		}
		sales = append(sales, s)
	}
	return sales, rows.Err()
}

func (st *Store) GetSale(id string) (Sale, error) {
	var s Sale
	err := st.db.QueryRow(
		`SELECT id, created_at, counter, cashier, customer, payment_method, subtotal_cents, discount_cents,
			total_cents, amount_paid_cents, change_cents, status, sync_state, note
		 FROM sales WHERE id = ?`, id,
	).Scan(&s.ID, &s.CreatedAt, &s.Counter, &s.Cashier, &s.Customer, &s.PaymentMethod,
		&s.SubtotalCents, &s.DiscountCents, &s.TotalCents, &s.AmountPaidCents, &s.ChangeCents,
		&s.Status, &s.SyncState, &s.Note)
	if err == sql.ErrNoRows {
		return Sale{}, fmt.Errorf("receipt %s not found", id)
	}
	if err != nil {
		return Sale{}, err
	}

	rows, err := st.db.Query(
		`SELECT product_id, sku, name, unit, unit_price_cents, qty, line_total_cents
		 FROM sale_items WHERE sale_id = ? ORDER BY id`, id,
	)
	if err != nil {
		return Sale{}, err
	}
	defer rows.Close()

	s.Items = []SaleItem{}
	for rows.Next() {
		var item SaleItem
		if err := rows.Scan(&item.ProductID, &item.SKU, &item.Name, &item.Unit,
			&item.UnitPriceCents, &item.Qty, &item.LineTotalCents); err != nil {
			return Sale{}, err
		}
		s.Items = append(s.Items, item)
	}
	s.ItemCount = len(s.Items)
	return s, rows.Err()
}

func (st *Store) VoidSale(id string, reason string) error {
	st.mu.Lock()
	defer st.mu.Unlock()

	sale, err := st.GetSale(id)
	if err != nil {
		return err
	}
	if sale.Status == saleStatusVoided {
		return fmt.Errorf("receipt %s is already voided", id)
	}
	if sale.SyncState == syncStateSynced {
		return fmt.Errorf("receipt %s was already synced to the server and cannot be voided offline", id)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	tx, err := st.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, item := range sale.Items {
		if _, err := tx.Exec(`UPDATE products SET stock = stock + ?, updated_at=? WHERE id=?`, item.Qty, now, item.ProductID); err != nil {
			return err
		}
		moveReason := "void " + id
		if strings.TrimSpace(reason) != "" {
			moveReason += ": " + strings.TrimSpace(reason)
		}
		if _, err := tx.Exec(
			`INSERT INTO stock_moves (product_id, delta, reason, created_at) VALUES (?,?,?,?)`,
			item.ProductID, item.Qty, moveReason, now,
		); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE sales SET status=?, sync_state=? WHERE id=?`, saleStatusVoided, syncStatePending, id); err != nil {
		return err
	}

	sale.Status = saleStatusVoided
	sale.SyncState = syncStatePending
	if sale.Note != "" && reason != "" {
		sale.Note += " | "
	}
	if reason != "" {
		sale.Note += "voided: " + strings.TrimSpace(reason)
	}
	ctx := contextFromConfig()
	ctx.Counter = sale.Counter
	ctx.Cashier = sale.Cashier
	payload, err := marshalOutboxPayload(ctx, sale)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(
		`INSERT INTO outbox (sale_id, payload, attempts, last_error, state, created_at, updated_at)
		 VALUES (?,?,0,'',?,?,?)
		 ON CONFLICT(sale_id) DO UPDATE SET payload=excluded.payload, attempts=0, last_error='',
			state=excluded.state, updated_at=excluded.updated_at, sent_at=''`,
		id, payload, syncStatePending, now, now,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (st *Store) GetDashboard() (Dashboard, error) {
	now := time.Now()
	todayStart := startOfLocalDay(now).UTC()
	weekStart := startOfLocalDay(now).AddDate(0, 0, -6).UTC()
	todayRFC := todayStart.Format(time.RFC3339)
	weekRFC := weekStart.Format(time.RFC3339)

	dash := Dashboard{
		RangeStart:  startOfLocalDay(now).Format("2006-01-02"),
		Week:        []DayStat{},
		TopProducts: []TopProduct{},
		LowStock:    []Product{},
	}

	if err := st.db.QueryRow(
		`SELECT COUNT(*), COALESCE(SUM(total_cents),0) FROM sales WHERE status=? AND created_at>=?`,
		saleStatusCompleted, todayRFC,
	).Scan(&dash.TodayTransactions, &dash.TodayRevenueCents); err != nil {
		return dash, err
	}
	if dash.TodayTransactions > 0 {
		dash.AvgBasketCents = dash.TodayRevenueCents / int64(dash.TodayTransactions)
	}
	if err := st.db.QueryRow(
		`SELECT COALESCE(SUM(si.qty),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id
		 WHERE s.status=? AND s.created_at>=?`,
		saleStatusCompleted, todayRFC,
	).Scan(&dash.TodayItems); err != nil {
		return dash, err
	}
	if err := st.db.QueryRow(
		`SELECT COALESCE(SUM(si.line_total_cents - p.cost_cents * si.qty),0)
		 FROM sale_items si
		 JOIN sales s ON s.id=si.sale_id
		 JOIN products p ON p.id=si.product_id
		 WHERE s.status=? AND s.created_at>=?`,
		saleStatusCompleted, todayRFC,
	).Scan(&dash.TodayProfitCents); err != nil {
		return dash, err
	}

	rows, err := st.db.Query(
		`SELECT created_at, total_cents FROM sales WHERE status=? AND created_at>=? ORDER BY created_at`,
		saleStatusCompleted, weekRFC,
	)
	if err != nil {
		return dash, err
	}
	buckets := map[string]*DayStat{}
	for rows.Next() {
		var createdAt string
		var total int64
		if err := rows.Scan(&createdAt, &total); err != nil {
			rows.Close()
			return dash, err
		}
		key := localDayKey(createdAt)
		if key < startOfLocalDay(now).Format("2006-01-02") {
			continue
		}
		if buckets[key] == nil {
			buckets[key] = &DayStat{Date: key}
		}
		buckets[key].RevenueCents += total
		buckets[key].Transactions++
	}
	rows.Close()

	for i := 0; i < 7; i++ {
		key := startOfLocalDay(now).AddDate(0, 0, -i).Format("2006-01-02")
		if b, ok := buckets[key]; ok {
			dash.Week = append(dash.Week, *b)
		} else {
			dash.Week = append(dash.Week, DayStat{Date: key})
		}
	}
	sort.Slice(dash.Week, func(i, j int) bool { return dash.Week[i].Date < dash.Week[j].Date })

	topRows, err := st.db.Query(
		`SELECT si.product_id, si.name, COALESCE(SUM(si.qty),0), COALESCE(SUM(si.line_total_cents),0)
		 FROM sale_items si JOIN sales s ON s.id=si.sale_id
		 WHERE s.status=? AND s.created_at>=?
		 GROUP BY si.product_id, si.name
		 ORDER BY COALESCE(SUM(si.line_total_cents),0) DESC
		 LIMIT 6`,
		saleStatusCompleted, weekRFC,
	)
	if err != nil {
		return dash, err
	}
	defer topRows.Close()
	for topRows.Next() {
		var t TopProduct
		if err := topRows.Scan(&t.ProductID, &t.Name, &t.Qty, &t.RevenueCents); err != nil {
			return dash, err
		}
		dash.TopProducts = append(dash.TopProducts, t)
	}
	if err := topRows.Err(); err != nil {
		return dash, err
	}

	low, err := st.ListProducts(ProductFilter{LowStockOnly: true})
	if err != nil {
		return dash, err
	}
	sort.Slice(low, func(i, j int) bool { return low[i].Stock < low[j].Stock })
	if len(low) > 8 {
		low = low[:8]
	}
	dash.LowStock = low

	if err := st.db.QueryRow(`SELECT COUNT(*) FROM products WHERE archived=0`).Scan(&dash.ProductCount); err != nil {
		return dash, err
	}
	pending, _, err := st.OutboxCounts()
	if err != nil {
		return dash, err
	}
	dash.PendingSync = pending
	return dash, nil
}

func (st *Store) OutboxCounts() (pending int, failed int, err error) {
	err = st.db.QueryRow(
		`SELECT
			COALESCE(SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN state='pending' AND attempts>0 THEN 1 ELSE 0 END),0)
		 FROM outbox`,
	).Scan(&pending, &failed)
	return pending, failed, err
}

func (st *Store) PendingOutbox(limit int) ([]OutboxRow, error) {
	rows, err := st.db.Query(
		`SELECT id, sale_id, payload, attempts, last_error, state, created_at
		 FROM outbox WHERE state='pending' ORDER BY id LIMIT ?`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []OutboxRow{}
	for rows.Next() {
		var r OutboxRow
		if err := rows.Scan(&r.ID, &r.SaleID, &r.Payload, &r.Attempts, &r.LastError, &r.State, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (st *Store) MarkOutboxSent(id int64) error {
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := st.db.Exec(`UPDATE outbox SET state='sent', attempts=attempts+1, last_error='', updated_at=?, sent_at=? WHERE id=?`,
		now, now, id); err != nil {
		return err
	}
	_, err := st.db.Exec(
		`UPDATE sales SET sync_state=? WHERE id=(SELECT sale_id FROM outbox WHERE id=?)`,
		syncStateSynced, id,
	)
	return err
}

func (st *Store) MarkOutboxAttempt(id int64, message string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	if len(message) > 300 {
		message = message[:300]
	}
	if _, err := st.db.Exec(`UPDATE outbox SET attempts=attempts+1, last_error=?, updated_at=? WHERE id=?`,
		message, now, id); err != nil {
		return err
	}
	_, err := st.db.Exec(
		`UPDATE sales SET sync_state='failed' WHERE sync_state=? AND id=(SELECT sale_id FROM outbox WHERE id=?)`,
		syncStatePending, id,
	)
	return err
}

func generateSKU(name string) string {
	base := strings.ToUpper(name)
	var b strings.Builder
	for _, r := range base {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	sku := b.String()
	if len(sku) > 8 {
		sku = sku[:8]
	}
	if sku == "" {
		sku = "ITEM"
	}
	return "SKU-" + sku
}

func normalizeSQLError(err error, sku string) error {
	msg := err.Error()
	if strings.Contains(msg, "UNIQUE constraint failed: products.sku") {
		return fmt.Errorf("SKU %s is already used by another product", sku)
	}
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func roundCents(v float64) int64 {
	return int64(math.Round(v))
}

func formatCents(cents int64) string {
	return fmt.Sprintf("%.2f", float64(cents)/100)
}

func startOfLocalDay(t time.Time) time.Time {
	loc := t.Location()
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, loc)
}

func localDayKey(iso string) string {
	ts, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return iso[:10]
	}
	return ts.In(time.Local).Format("2006-01-02")
}

func rangeStart(key string) (time.Time, bool) {
	now := time.Now()
	switch key {
	case "today":
		return startOfLocalDay(now), true
	case "yesterday":
		return startOfLocalDay(now).AddDate(0, 0, -1), true
	case "7d":
		return startOfLocalDay(now).AddDate(0, 0, -6), true
	case "30d":
		return startOfLocalDay(now).AddDate(0, 0, -29), true
	case "", "all":
		return time.Time{}, false
	default:
		return time.Time{}, false
	}
}
