package main

type PosService struct{}

func (s *PosService) GetProducts(f ProductFilter) ([]Product, error) {
	store, err := openStoreIfNeeded()
	if err != nil {
		return nil, err
	}
	return store.ListProducts(f)
}

func (s *PosService) GetCategories() ([]string, error) {
	store, err := openStoreIfNeeded()
	if err != nil {
		return nil, err
	}
	return store.GetCategories()
}

func (s *PosService) Checkout(req CheckoutRequest) (CheckoutResult, error) {
	store, err := openStoreIfNeeded()
	if err != nil {
		return CheckoutResult{}, err
	}
	result, err := store.Checkout(req, contextFromConfig())
	if err != nil {
		return CheckoutResult{}, err
	}
	emitSyncStatus()
	return result, nil
}

func (s *PosService) GetSales(f SalesFilter) ([]SaleSummary, error) {
	store, err := openStoreIfNeeded()
	if err != nil {
		return nil, err
	}
	return store.GetSales(f)
}

func (s *PosService) GetSale(id string) (Sale, error) {
	store, err := openStoreIfNeeded()
	if err != nil {
		return Sale{}, err
	}
	return store.GetSale(id)
}

func (s *PosService) VoidSale(id string, reason string) error {
	store, err := openStoreIfNeeded()
	if err != nil {
		return err
	}
	if err := store.VoidSale(id, reason); err != nil {
		return err
	}
	emitSyncStatus()
	return nil
}

func (s *PosService) GetDashboard() (Dashboard, error) {
	store, err := openStoreIfNeeded()
	if err != nil {
		return Dashboard{}, err
	}
	return store.GetDashboard()
}

func (s *PosService) SaveProduct(p Product) (Product, error) {
	store, err := openStoreIfNeeded()
	if err != nil {
		return Product{}, err
	}
	return store.SaveProduct(p)
}

func (s *PosService) AdjustStock(req StockAdjustment) (Product, error) {
	store, err := openStoreIfNeeded()
	if err != nil {
		return Product{}, err
	}
	return store.AdjustStock(req)
}

func (s *PosService) ArchiveProduct(id int64, archived bool) error {
	store, err := openStoreIfNeeded()
	if err != nil {
		return err
	}
	return store.ArchiveProduct(id, archived)
}

func (s *PosService) GetSyncStatus() (SyncStatus, error) {
	return getSyncStatus(), nil
}

func (s *PosService) SyncNow() (SyncStatus, error) {
	return syncNow(), nil
}
