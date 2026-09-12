# billing

Two packages. `format` renders money for display; `invoices` builds the lines of an invoice with it and
is what the customer-facing PDF reads. Each package has its own tests, run with `vitest run` inside
the package.
