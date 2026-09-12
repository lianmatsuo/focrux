-- Codes must be unique: two SKUs with the same code break fulfilment routing.
CREATE UNIQUE INDEX idx_skus_code ON skus (code);
