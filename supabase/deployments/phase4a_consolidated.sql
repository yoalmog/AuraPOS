-- ==============================================================================
-- AuraPOS Production Deployment Package: Phase 4A Consolidated Schema
-- File: supabase/deployments/phase4a_consolidated.sql
-- Target: Supabase PostgreSQL (Dashboard SQL Editor or Direct Migration)
--
-- This consolidated migration establishes the complete, production-grade cloud
-- foundation for AuraPOS:
-- 1. All 28 Core & Operational Tables with UUID primary keys & constraints
-- 2. Soft-delete tombstones (deleted_at) and version tracking across master data
-- 3. System seed roles and granular permissions (OWNER, ADMIN, MANAGER, CASHIER)
-- 4. Multi-tenant Row Level Security (RLS) policies with store isolation
-- 5. Supabase Storage bucket ('aurapos-media') with store folder isolation
-- 6. Server-side atomic stored procedures & RPC functions:
--    - sync_process_sale / process_sale_atomic
--    - sync_process_cash_shift / open_cash_shift_atomic / close_cash_shift_atomic
--    - record_inventory_movement_atomic
--    - sync_pull_changes (incremental cursor-based pull)
--    - sync_backend_health (diagnostics & server time)
-- 7. Schema permissions and PostgREST cache notification
--
-- Idempotent & Re-run Safe: Can be safely run on a fresh or partially migrated database.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- STEP 1: EXTENSIONS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- STEP 2: CORE & OPERATIONAL TABLES (28 TABLES)
-- ------------------------------------------------------------------------------

-- 1. STORES
CREATE TABLE IF NOT EXISTS public.stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    legal_name TEXT,
    address JSONB DEFAULT '{}'::jsonb,
    phone TEXT,
    email TEXT,
    currency TEXT NOT NULL DEFAULT '$',
    timezone TEXT NOT NULL DEFAULT 'UTC',
    default_locale TEXT NOT NULL DEFAULT 'en',
    tax_number TEXT,
    logo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TERMINALS (Hardware Cashier POS Terminals)
CREATE TABLE IF NOT EXISTS public.terminals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    device_identifier TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
    last_seen_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_terminal_device UNIQUE(store_id, device_identifier)
);

-- 3. ROLES & PERMISSIONS
CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    module TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 4. USER PROFILES & USER ROLES
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    phone TEXT,
    pin_hash TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- 5. CATEGORIES & TRANSLATIONS
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    default_locale TEXT NOT NULL DEFAULT 'en',
    icon TEXT NOT NULL DEFAULT 'Utensils',
    image_url TEXT,
    color TEXT NOT NULL DEFAULT '#2563EB',
    sort_order INT NOT NULL DEFAULT 0,
    parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    printer_id UUID,
    auto_print_kitchen BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.category_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    locale TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cat_translation UNIQUE(category_id, locale)
);

-- 6. TAXES
CREATE TABLE IF NOT EXISTS public.taxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rate NUMERIC(6, 4) NOT NULL,
    inclusive BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. PRODUCTS, TRANSLATIONS & VARIANTS
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    tax_id UUID REFERENCES public.taxes(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    sku TEXT,
    barcode TEXT,
    description TEXT,
    price NUMERIC(12, 2) NOT NULL,
    cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'item',
    track_inventory BOOLEAN NOT NULL DEFAULT TRUE,
    stock_minimum NUMERIC(12, 2) NOT NULL DEFAULT 0,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    image_url TEXT,
    image_metadata JSONB DEFAULT '{}'::jsonb,
    deleted_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    locale TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_prod_translation UNIQUE(product_id, locale)
);

CREATE TABLE IF NOT EXISTS public.product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT,
    barcode TEXT,
    price NUMERIC(12, 2) NOT NULL,
    cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. CUSTOMERS
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    notes TEXT,
    loyalty_points INT NOT NULL DEFAULT 0,
    lifetime_points INT NOT NULL DEFAULT 0,
    total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_orders INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. SALES, SALE ITEMS, PAYMENTS & REFUNDS
CREATE TABLE IF NOT EXISTS public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    terminal_id UUID REFERENCES public.terminals(id) ON DELETE SET NULL,
    cashier_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    receipt_number TEXT NOT NULL,
    order_type TEXT NOT NULL DEFAULT 'dine_in',
    status TEXT NOT NULL CHECK (status IN ('completed', 'refunded', 'partially_refunded', 'cancelled')),
    subtotal NUMERIC(12, 2) NOT NULL,
    discount_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total NUMERIC(12, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT '$',
    is_offline BOOLEAN NOT NULL DEFAULT FALSE,
    client_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sale_receipt UNIQUE(store_id, receipt_number)
);

CREATE TABLE IF NOT EXISTS public.sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
    product_name_snapshot TEXT NOT NULL,
    sku_snapshot TEXT,
    quantity NUMERIC(12, 2) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'mobile', 'bank', 'loyalty', 'yape', 'plin', 'other')),
    amount NUMERIC(12, 2) NOT NULL,
    tendered NUMERIC(12, 2),
    change NUMERIC(12, 2),
    status TEXT NOT NULL DEFAULT 'completed',
    provider_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. INVENTORY & INVENTORY MOVEMENTS (Movement-based Ledger)
CREATE TABLE IF NOT EXISTS public.inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_store_product_inv UNIQUE(store_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('sale', 'refund', 'adjustment', 'purchase', 'transfer', 'damaged', 'count')),
    quantity NUMERIC(12, 2) NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    terminal_id UUID REFERENCES public.terminals(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. CASH SHIFTS & CASH MOVEMENTS
CREATE TABLE IF NOT EXISTS public.cash_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    terminal_id UUID REFERENCES public.terminals(id) ON DELETE SET NULL,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    opening_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    closing_amount NUMERIC(12, 2),
    expected_amount NUMERIC(12, 2),
    difference NUMERIC(12, 2),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.cash_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('cash_in', 'cash_out', 'drop', 'payout')),
    amount NUMERIC(12, 2) NOT NULL,
    reason TEXT,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. PRINTERS, PRINTER ROUTING & PRINT JOBS
CREATE TABLE IF NOT EXISTS public.printers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    terminal_id UUID REFERENCES public.terminals(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    connection_type TEXT NOT NULL CHECK (connection_type IN ('BLUETOOTH', 'USB', 'NETWORK', 'BUILTIN', 'BROWSER')),
    device_identifier TEXT,
    address TEXT,
    port INT DEFAULT 9100,
    protocol TEXT NOT NULL DEFAULT 'ESC_POS',
    paper_width INT NOT NULL DEFAULT 58,
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.printer_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL DEFAULT 'receipt',
    priority INT NOT NULL DEFAULT 0,
    auto_print BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.print_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    terminal_id UUID REFERENCES public.terminals(id) ON DELETE SET NULL,
    printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
    sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PRINTING', 'PRINTED', 'FAILED', 'CANCELLED')),
    attempt_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    printed_at TIMESTAMPTZ
);

-- 13. IDEMPOTENT OFFLINE SYNC TABLES
CREATE TABLE IF NOT EXISTS public.sync_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_event_id TEXT NOT NULL UNIQUE,
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    terminal_id UUID REFERENCES public.terminals(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.sync_cursors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
    terminal_id UUID NOT NULL REFERENCES public.terminals(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    cursor TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_terminal_entity_cursor UNIQUE(terminal_id, entity_type)
);

-- 14. AUDIT LOGS (Append-Only)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    terminal_id UUID REFERENCES public.terminals(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. STORE SETTINGS
CREATE TABLE IF NOT EXISTS public.store_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_store_settings_key UNIQUE(store_id, key)
);

-- Re-run safety for soft-delete & version columns on existing tables
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.product_translations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.category_translations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.taxes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.taxes ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.terminals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.terminals ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.sync_cursors ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;

-- ------------------------------------------------------------------------------
-- STEP 3: SYSTEM SEED DATA (ROLES & GRANULAR PERMISSIONS)
-- ------------------------------------------------------------------------------
INSERT INTO public.roles (name, description) VALUES
    ('OWNER', 'Full store owner with administrative, financial, and management privileges'),
    ('ADMIN', 'Store administrator with system setup and management permissions'),
    ('MANAGER', 'Store shift manager with catalog, inventory, and discount permissions'),
    ('CASHIER', 'Front-desk point-of-sale operator with ring and checkout permissions')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.permissions (code, module, description) VALUES
    ('pos.view', 'pos', 'Access point-of-sale terminal view'),
    ('pos.sell', 'pos', 'Process items and complete sales'),
    ('pos.discount', 'pos', 'Apply manual or order discounts'),
    ('pos.void', 'pos', 'Void current cart or line items'),
    ('pos.refund', 'pos', 'Process transaction refunds'),
    ('pos.open_drawer', 'pos', 'Trigger kick pulse on cash drawer'),
    ('product.view', 'product', 'View product catalog and pricing'),
    ('product.create', 'product', 'Create new products and variants'),
    ('product.edit', 'product', 'Modify product details, prices, and images'),
    ('product.delete', 'product', 'Archive or delete products'),
    ('category.view', 'category', 'View product categories'),
    ('category.create', 'category', 'Create new catalog categories'),
    ('category.edit', 'category', 'Update category details and colors'),
    ('category.delete', 'category', 'Remove categories with product reassignment'),
    ('category.reorder', 'category', 'Reorder category display precedence'),
    ('inventory.view', 'inventory', 'View stock levels and movement history'),
    ('inventory.adjust', 'inventory', 'Perform stock adjustments and counts'),
    ('inventory.transfer', 'inventory', 'Transfer inventory between locations'),
    ('customer.view', 'customer', 'View customer directory and history'),
    ('customer.create', 'customer', 'Register new customer accounts'),
    ('customer.edit', 'customer', 'Update customer details and loyalty info'),
    ('sales.view', 'sales', 'View transaction history and receipts'),
    ('sales.refund', 'sales', 'Execute partial or full order refunds'),
    ('reports.view', 'reports', 'Access analytics and financial reports'),
    ('users.view', 'users', 'View staff directory and profiles'),
    ('users.manage', 'users', 'Create and modify employee accounts and PINs'),
    ('roles.view', 'roles', 'View role definitions'),
    ('roles.manage', 'roles', 'Assign roles and update permissions'),
    ('stores.manage', 'stores', 'Configure store details, tax ID, and receipts'),
    ('terminals.manage', 'terminals', 'Register and pair POS terminals'),
    ('printers.view', 'printers', 'View configured thermal printers'),
    ('printers.manage', 'printers', 'Pair and configure Bluetooth, USB, and LAN printers'),
    ('settings.view', 'settings', 'View application and store settings'),
    ('settings.manage', 'settings', 'Update store branding, taxes, and hardware config'),
    ('audit.view', 'audit', 'Review administrative and transactional audit logs')
ON CONFLICT (code) DO NOTHING;

-- Map OWNER role with all system permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.name = 'OWNER'
ON CONFLICT DO NOTHING;

-- Map CASHIER role with operational POS permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.name = 'CASHIER' AND p.code IN (
    'pos.view', 'pos.sell', 'pos.open_drawer',
    'product.view', 'category.view', 'customer.view', 'customer.create',
    'sales.view', 'printers.view'
)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------
-- STEP 4: INDEXES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_terminals_store ON public.terminals(store_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_store ON public.user_profiles(store_id);
CREATE INDEX IF NOT EXISTS idx_categories_store ON public.categories(store_id);
CREATE INDEX IF NOT EXISTS idx_categories_updated_at ON public.categories(updated_at);
CREATE INDEX IF NOT EXISTS idx_products_store ON public.products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_updated_at ON public.products(updated_at);
CREATE INDEX IF NOT EXISTS idx_customers_store ON public.customers(store_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON public.customers(updated_at);
CREATE INDEX IF NOT EXISTS idx_taxes_updated_at ON public.taxes(updated_at);
CREATE INDEX IF NOT EXISTS idx_sales_store ON public.sales(store_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON public.sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_receipt ON public.sales(receipt_number);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON public.payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON public.inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_store ON public.inventory_movements(store_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON public.inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_store ON public.cash_shifts(store_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON public.cash_movements(shift_id);
CREATE INDEX IF NOT EXISTS idx_printers_store ON public.printers(store_id);
CREATE INDEX IF NOT EXISTS idx_printers_updated_at ON public.printers(updated_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON public.print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_printer ON public.print_jobs(printer_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_terminal ON public.print_jobs(terminal_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_created_at ON public.print_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_events_store_status ON public.sync_events(store_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_events_status ON public.sync_events(status);
CREATE INDEX IF NOT EXISTS idx_sync_events_client_id ON public.sync_events(client_event_id);
CREATE INDEX IF NOT EXISTS idx_sync_cursors_store_entity ON public.sync_cursors(store_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_store ON public.audit_logs(store_id);

-- ------------------------------------------------------------------------------
-- STEP 5: SECURITY HELPER FUNCTIONS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_user_store_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT store_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_user_has_permission(permission_code TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON ur.role_id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid()
      AND p.code = permission_code
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_user_is_owner_or_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
      AND r.name IN ('OWNER', 'ADMIN')
  );
$$;

-- ------------------------------------------------------------------------------
-- STEP 6: ROW LEVEL SECURITY & POLICIES (ALL 28 TABLES)
-- ------------------------------------------------------------------------------
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printer_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

-- Stores policies
DROP POLICY IF EXISTS "Users can view their authorized store" ON public.stores;
CREATE POLICY "Users can view their authorized store"
    ON public.stores FOR SELECT
    USING (id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Owners can update store configuration" ON public.stores;
CREATE POLICY "Owners can update store configuration"
    ON public.stores FOR UPDATE
    USING (id = public.auth_user_store_id() AND public.auth_user_has_permission('stores.manage'));

-- Terminals policies
DROP POLICY IF EXISTS "Users can view terminals in their store" ON public.terminals;
CREATE POLICY "Users can view terminals in their store"
    ON public.terminals FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Managers can manage terminals" ON public.terminals;
CREATE POLICY "Managers can manage terminals"
    ON public.terminals FOR ALL
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('terminals.manage'));

-- User profiles & roles policies
DROP POLICY IF EXISTS "Users can view profiles in their store" ON public.user_profiles;
CREATE POLICY "Users can view profiles in their store"
    ON public.user_profiles FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Managers can manage user profiles" ON public.user_profiles;
CREATE POLICY "Managers can manage user profiles"
    ON public.user_profiles FOR ALL
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('users.manage'));

DROP POLICY IF EXISTS "Users can view roles and permissions" ON public.roles;
CREATE POLICY "Users can view roles and permissions"
    ON public.roles FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can view permissions" ON public.permissions;
CREATE POLICY "Users can view permissions"
    ON public.permissions FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can view role permissions" ON public.role_permissions;
CREATE POLICY "Users can view role permissions"
    ON public.role_permissions FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can view user roles in their store" ON public.user_roles;
CREATE POLICY "Users can view user roles in their store"
    ON public.user_roles FOR SELECT
    USING (user_id IN (SELECT id FROM public.user_profiles WHERE store_id = public.auth_user_store_id()));

-- Categories policies
DROP POLICY IF EXISTS "Users can view categories in their store" ON public.categories;
CREATE POLICY "Users can view categories in their store"
    ON public.categories FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Managers can manage categories" ON public.categories;
CREATE POLICY "Managers can manage categories"
    ON public.categories FOR INSERT
    WITH CHECK (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('category.create'));

DROP POLICY IF EXISTS "Managers can update categories" ON public.categories;
CREATE POLICY "Managers can update categories"
    ON public.categories FOR UPDATE
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('category.edit'));

DROP POLICY IF EXISTS "Managers can delete categories" ON public.categories;
CREATE POLICY "Managers can delete categories"
    ON public.categories FOR DELETE
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('category.delete'));

DROP POLICY IF EXISTS "Users can view category translations" ON public.category_translations;
CREATE POLICY "Users can view category translations"
    ON public.category_translations FOR SELECT
    USING (category_id IN (SELECT id FROM public.categories WHERE store_id = public.auth_user_store_id()));

DROP POLICY IF EXISTS "Managers can manage category translations" ON public.category_translations;
CREATE POLICY "Managers can manage category translations"
    ON public.category_translations FOR ALL
    USING (category_id IN (SELECT id FROM public.categories WHERE store_id = public.auth_user_store_id())
           AND public.auth_user_has_permission('category.edit'));

-- Taxes policies
DROP POLICY IF EXISTS "Users can view taxes in their store" ON public.taxes;
CREATE POLICY "Users can view taxes in their store"
    ON public.taxes FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Managers can manage taxes" ON public.taxes;
CREATE POLICY "Managers can manage taxes"
    ON public.taxes FOR ALL
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('settings.manage'));

-- Products, translations & variants policies
DROP POLICY IF EXISTS "Users can view products in their store" ON public.products;
CREATE POLICY "Users can view products in their store"
    ON public.products FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Authorized staff can insert products" ON public.products;
CREATE POLICY "Authorized staff can insert products"
    ON public.products FOR INSERT
    WITH CHECK (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('product.create'));

DROP POLICY IF EXISTS "Authorized staff can update products" ON public.products;
CREATE POLICY "Authorized staff can update products"
    ON public.products FOR UPDATE
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('product.edit'));

DROP POLICY IF EXISTS "Authorized staff can delete products" ON public.products;
CREATE POLICY "Authorized staff can delete products"
    ON public.products FOR DELETE
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('product.delete'));

DROP POLICY IF EXISTS "Users can view product variants" ON public.product_variants;
CREATE POLICY "Users can view product variants"
    ON public.product_variants FOR SELECT
    USING (product_id IN (SELECT id FROM public.products WHERE store_id = public.auth_user_store_id()));

DROP POLICY IF EXISTS "Authorized staff can manage product variants" ON public.product_variants;
CREATE POLICY "Authorized staff can manage product variants"
    ON public.product_variants FOR ALL
    USING (product_id IN (SELECT id FROM public.products WHERE store_id = public.auth_user_store_id())
           AND public.auth_user_has_permission('product.edit'));

DROP POLICY IF EXISTS "Users can view product translations" ON public.product_translations;
CREATE POLICY "Users can view product translations"
    ON public.product_translations FOR SELECT
    USING (product_id IN (SELECT id FROM public.products WHERE store_id = public.auth_user_store_id()));

DROP POLICY IF EXISTS "Staff can manage product translations" ON public.product_translations;
CREATE POLICY "Staff can manage product translations"
    ON public.product_translations FOR ALL
    USING (product_id IN (SELECT id FROM public.products WHERE store_id = public.auth_user_store_id())
           AND public.auth_user_has_permission('product.edit'));

-- Customers policies
DROP POLICY IF EXISTS "Users can view customers in their store" ON public.customers;
CREATE POLICY "Users can view customers in their store"
    ON public.customers FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Authorized staff can create customers" ON public.customers;
CREATE POLICY "Authorized staff can create customers"
    ON public.customers FOR INSERT
    WITH CHECK (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('customer.create'));

DROP POLICY IF EXISTS "Authorized staff can update customers" ON public.customers;
CREATE POLICY "Authorized staff can update customers"
    ON public.customers FOR UPDATE
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('customer.edit'));

-- Sales, items & payments policies
DROP POLICY IF EXISTS "Users can view sales in their store" ON public.sales;
CREATE POLICY "Users can view sales in their store"
    ON public.sales FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Cashiers can insert sales" ON public.sales;
CREATE POLICY "Cashiers can insert sales"
    ON public.sales FOR INSERT
    WITH CHECK (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('pos.sell'));

DROP POLICY IF EXISTS "Staff can update sales status (refund/void)" ON public.sales;
CREATE POLICY "Staff can update sales status (refund/void)"
    ON public.sales FOR UPDATE
    USING (store_id = public.auth_user_store_id() AND (public.auth_user_has_permission('sales.refund') OR public.auth_user_has_permission('pos.void')));

DROP POLICY IF EXISTS "Users can view sale items" ON public.sale_items;
CREATE POLICY "Users can view sale items"
    ON public.sale_items FOR SELECT
    USING (sale_id IN (SELECT id FROM public.sales WHERE store_id = public.auth_user_store_id()));

DROP POLICY IF EXISTS "Cashiers can insert sale items" ON public.sale_items;
CREATE POLICY "Cashiers can insert sale items"
    ON public.sale_items FOR INSERT
    WITH CHECK (sale_id IN (SELECT id FROM public.sales WHERE store_id = public.auth_user_store_id()));

DROP POLICY IF EXISTS "Users can view payments" ON public.payments;
CREATE POLICY "Users can view payments"
    ON public.payments FOR SELECT
    USING (sale_id IN (SELECT id FROM public.sales WHERE store_id = public.auth_user_store_id()));

DROP POLICY IF EXISTS "Cashiers can insert payments" ON public.payments;
CREATE POLICY "Cashiers can insert payments"
    ON public.payments FOR INSERT
    WITH CHECK (sale_id IN (SELECT id FROM public.sales WHERE store_id = public.auth_user_store_id()));

DROP POLICY IF EXISTS "Users can view refunds" ON public.refunds;
CREATE POLICY "Users can view refunds"
    ON public.refunds FOR SELECT
    USING (sale_id IN (SELECT id FROM public.sales WHERE store_id = public.auth_user_store_id()));

DROP POLICY IF EXISTS "Authorized staff can insert refunds" ON public.refunds;
CREATE POLICY "Authorized staff can insert refunds"
    ON public.refunds FOR INSERT
    WITH CHECK (sale_id IN (SELECT id FROM public.sales WHERE store_id = public.auth_user_store_id())
                AND public.auth_user_has_permission('pos.refund'));

-- Inventory & movements policies
DROP POLICY IF EXISTS "Users can view inventory in their store" ON public.inventory;
CREATE POLICY "Users can view inventory in their store"
    ON public.inventory FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Staff can update inventory quantities" ON public.inventory;
CREATE POLICY "Staff can update inventory quantities"
    ON public.inventory FOR ALL
    USING (store_id = public.auth_user_store_id() AND (
        public.auth_user_has_permission('inventory.adjust') OR
        public.auth_user_has_permission('pos.sell')
    ));

DROP POLICY IF EXISTS "Users can view inventory movements" ON public.inventory_movements;
CREATE POLICY "Users can view inventory movements"
    ON public.inventory_movements FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Authorized staff can insert inventory movements" ON public.inventory_movements;
CREATE POLICY "Authorized staff can insert inventory movements"
    ON public.inventory_movements FOR INSERT
    WITH CHECK (store_id = public.auth_user_store_id() AND (
        public.auth_user_has_permission('inventory.adjust') OR
        public.auth_user_has_permission('pos.sell') OR
        public.auth_user_has_permission('pos.refund')
    ));

-- Cash shifts & movements policies
DROP POLICY IF EXISTS "Users can view cash shifts in their store" ON public.cash_shifts;
CREATE POLICY "Users can view cash shifts in their store"
    ON public.cash_shifts FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Cashiers can insert cash shifts" ON public.cash_shifts;
CREATE POLICY "Cashiers can insert cash shifts"
    ON public.cash_shifts FOR INSERT
    WITH CHECK (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('pos.view'));

DROP POLICY IF EXISTS "Staff can update cash shifts" ON public.cash_shifts;
CREATE POLICY "Staff can update cash shifts"
    ON public.cash_shifts FOR UPDATE
    USING (store_id = public.auth_user_store_id() AND (public.auth_user_has_permission('pos.view') OR public.auth_user_has_permission('settings.manage')));

DROP POLICY IF EXISTS "Users can view cash movements" ON public.cash_movements;
CREATE POLICY "Users can view cash movements"
    ON public.cash_movements FOR SELECT
    USING (shift_id IN (SELECT id FROM public.cash_shifts WHERE store_id = public.auth_user_store_id()));

DROP POLICY IF EXISTS "Cashiers can insert cash movements" ON public.cash_movements;
CREATE POLICY "Cashiers can insert cash movements"
    ON public.cash_movements FOR INSERT
    WITH CHECK (shift_id IN (SELECT id FROM public.cash_shifts WHERE store_id = public.auth_user_store_id()) AND public.auth_user_has_permission('pos.view'));

-- Printers & print jobs policies
DROP POLICY IF EXISTS "Users can view printers in their store" ON public.printers;
CREATE POLICY "Users can view printers in their store"
    ON public.printers FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Managers can manage printers" ON public.printers;
CREATE POLICY "Managers can manage printers"
    ON public.printers FOR ALL
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('printers.manage'));

DROP POLICY IF EXISTS "Users can view printer routes" ON public.printer_routes;
CREATE POLICY "Users can view printer routes"
    ON public.printer_routes FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Managers can manage printer routes" ON public.printer_routes;
CREATE POLICY "Managers can manage printer routes"
    ON public.printer_routes FOR ALL
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('printers.manage'));

DROP POLICY IF EXISTS "Users can view print jobs in their store" ON public.print_jobs;
CREATE POLICY "Users can view print jobs in their store"
    ON public.print_jobs FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Terminals can manage print jobs" ON public.print_jobs;
CREATE POLICY "Terminals can manage print jobs"
    ON public.print_jobs FOR ALL
    USING (store_id = public.auth_user_store_id());

-- Sync events & sync cursors policies
DROP POLICY IF EXISTS "Terminals can view and append sync events" ON public.sync_events;
CREATE POLICY "Terminals can view and append sync events"
    ON public.sync_events FOR ALL
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Terminals can view and update sync cursors" ON public.sync_cursors;
CREATE POLICY "Terminals can view and update sync cursors"
    ON public.sync_cursors FOR ALL
    USING (terminal_id IN (SELECT id FROM public.terminals WHERE store_id = public.auth_user_store_id()));

-- Audit logs & settings policies
DROP POLICY IF EXISTS "Users can view audit logs" ON public.audit_logs;
CREATE POLICY "Users can view audit logs"
    ON public.audit_logs FOR SELECT
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('audit.view'));

DROP POLICY IF EXISTS "System can append audit logs" ON public.audit_logs;
CREATE POLICY "System can append audit logs"
    ON public.audit_logs FOR INSERT
    WITH CHECK (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Users can view store settings" ON public.store_settings;
CREATE POLICY "Users can view store settings"
    ON public.store_settings FOR SELECT
    USING (store_id = public.auth_user_store_id());

DROP POLICY IF EXISTS "Owners can update store settings" ON public.store_settings;
CREATE POLICY "Owners can update store settings"
    ON public.store_settings FOR ALL
    USING (store_id = public.auth_user_store_id() AND public.auth_user_has_permission('settings.manage'));

-- ------------------------------------------------------------------------------
-- STEP 7: STORAGE BUCKET & STORAGE RLS POLICIES
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'aurapos-media',
    'aurapos-media',
    false,
    10485760, -- 10MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Store staff can read aurapos media" ON storage.objects;
CREATE POLICY "Store staff can read aurapos media"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'aurapos-media' AND
        auth.role() = 'authenticated' AND
        (storage.foldername(name))[1] = public.auth_user_store_id()::TEXT
    );

DROP POLICY IF EXISTS "Store staff can upload aurapos media" ON storage.objects;
CREATE POLICY "Store staff can upload aurapos media"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'aurapos-media' AND
        auth.role() = 'authenticated' AND
        (storage.foldername(name))[1] = public.auth_user_store_id()::TEXT
    );

DROP POLICY IF EXISTS "Store staff can delete aurapos media" ON storage.objects;
CREATE POLICY "Store staff can delete aurapos media"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'aurapos-media' AND
        auth.role() = 'authenticated' AND
        (storage.foldername(name))[1] = public.auth_user_store_id()::TEXT
    );

-- ------------------------------------------------------------------------------
-- STEP 8: SERVER-SIDE ATOMIC STORED PROCEDURES & RPC FUNCTIONS
-- ------------------------------------------------------------------------------

-- 1. sync_process_sale: Atomic sale + items + payments + inventory deduction
CREATE OR REPLACE FUNCTION public.sync_process_sale(
    p_sale JSONB,
    p_items JSONB,
    p_payments JSONB,
    p_movements JSONB,
    p_client_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sale_id UUID;
    v_store_id UUID;
    v_existing_sale_id UUID;
    v_item JSONB;
    v_payment JSONB;
    v_movement JSONB;
    v_product_id UUID;
    v_qty NUMERIC(12, 2);
    v_event_record RECORD;
BEGIN
    -- Idempotency check via client_event_id
    IF p_client_event_id IS NOT NULL THEN
        SELECT * INTO v_event_record FROM public.sync_events WHERE client_event_id = p_client_event_id;
        IF FOUND AND v_event_record.status = 'PROCESSED' THEN
            RETURN jsonb_build_object(
                'success', true,
                'status', 'IDEMPOTENT_IGNORED',
                'message', 'Event already processed idempotently',
                'sale_id', v_event_record.entity_id
            );
        END IF;
    END IF;

    -- Extract Sale Identifiers
    v_sale_id := (p_sale->>'id')::UUID;
    v_store_id := (p_sale->>'store_id')::UUID;

    IF v_sale_id IS NULL OR v_store_id IS NULL THEN
        RAISE EXCEPTION 'Missing required sale id or store_id';
    END IF;

    -- Security Authorization Check:
    -- Fail-closed: Anonymous callers cannot create sales; authenticated callers must possess a valid store membership and belong to the target store.
    IF auth.role() = 'anon' THEN
        RAISE EXCEPTION 'Access denied: anonymous callers cannot process sales';
    END IF;
    IF auth.uid() IS NOT NULL THEN
        IF auth_user_store_id() IS NULL THEN
            RAISE EXCEPTION 'Access denied: authenticated caller has no assigned store membership';
        END IF;
        IF auth_user_store_id() <> v_store_id THEN
            RAISE EXCEPTION 'Cross-store access denied: caller does not belong to store %', v_store_id;
        END IF;
    END IF;

    -- Check if sale already exists by primary key UUID
    SELECT id INTO v_existing_sale_id FROM public.sales WHERE id = v_sale_id;
    IF v_existing_sale_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'status', 'ALREADY_EXISTS',
            'sale_id', v_sale_id
        );
    END IF;

    -- Insert Sale Header
    INSERT INTO public.sales (
        id,
        store_id,
        terminal_id,
        cashier_id,
        customer_id,
        receipt_number,
        order_type,
        status,
        subtotal,
        discount_total,
        tax_total,
        total,
        currency,
        is_offline,
        client_created_at,
        created_at,
        updated_at
    ) VALUES (
        v_sale_id,
        v_store_id,
        CASE WHEN (p_sale->>'terminal_id') IS NOT NULL AND length(p_sale->>'terminal_id') = 36 THEN (p_sale->>'terminal_id')::UUID ELSE NULL END,
        CASE WHEN (p_sale->>'cashier_id') IS NOT NULL AND length(p_sale->>'cashier_id') = 36 THEN (p_sale->>'cashier_id')::UUID ELSE NULL END,
        CASE WHEN (p_sale->>'customer_id') IS NOT NULL AND length(p_sale->>'customer_id') = 36 THEN (p_sale->>'customer_id')::UUID ELSE NULL END,
        p_sale->>'receipt_number',
        COALESCE(p_sale->>'order_type', 'dine_in'),
        COALESCE(p_sale->>'status', 'completed'),
        (p_sale->>'subtotal')::NUMERIC(12, 2),
        COALESCE((p_sale->>'discount_total')::NUMERIC(12, 2), 0),
        COALESCE((p_sale->>'tax_total')::NUMERIC(12, 2), 0),
        (p_sale->>'total')::NUMERIC(12, 2),
        COALESCE(p_sale->>'currency', '$'),
        COALESCE((p_sale->>'is_offline')::BOOLEAN, true),
        COALESCE((p_sale->>'client_created_at')::TIMESTAMPTZ, NOW()),
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;

    -- Insert Sale Items
    IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            INSERT INTO public.sale_items (
                id,
                sale_id,
                product_id,
                variant_id,
                product_name_snapshot,
                sku_snapshot,
                quantity,
                unit_price,
                discount,
                tax,
                total,
                created_at
            ) VALUES (
                COALESCE((v_item->>'id')::UUID, gen_random_uuid()),
                v_sale_id,
                CASE WHEN (v_item->>'product_id') IS NOT NULL AND length(v_item->>'product_id') = 36 THEN (v_item->>'product_id')::UUID ELSE NULL END,
                CASE WHEN (v_item->>'variant_id') IS NOT NULL AND length(v_item->>'variant_id') = 36 THEN (v_item->>'variant_id')::UUID ELSE NULL END,
                COALESCE(v_item->>'product_name_snapshot', v_item->>'product_name', 'Item'),
                v_item->>'sku_snapshot',
                (v_item->>'quantity')::NUMERIC(12, 2),
                (v_item->>'unit_price')::NUMERIC(12, 2),
                COALESCE((v_item->>'discount')::NUMERIC(12, 2), 0),
                COALESCE((v_item->>'tax')::NUMERIC(12, 2), 0),
                (v_item->>'total')::NUMERIC(12, 2),
                COALESCE((v_item->>'created_at')::TIMESTAMPTZ, NOW())
            )
            ON CONFLICT (id) DO NOTHING;
        END LOOP;
    END IF;

    -- Insert Payments
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' THEN
        FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
        LOOP
            INSERT INTO public.payments (
                id,
                sale_id,
                method,
                amount,
                tendered,
                change,
                status,
                provider_reference,
                created_at,
                updated_at
            ) VALUES (
                COALESCE((v_payment->>'id')::UUID, gen_random_uuid()),
                v_sale_id,
                COALESCE(v_payment->>'method', 'cash'),
                (v_payment->>'amount')::NUMERIC(12, 2),
                CASE WHEN (v_payment->>'tendered') IS NOT NULL THEN (v_payment->>'tendered')::NUMERIC(12, 2) ELSE NULL END,
                CASE WHEN (v_payment->>'change') IS NOT NULL THEN (v_payment->>'change')::NUMERIC(12, 2) ELSE NULL END,
                COALESCE(v_payment->>'status', 'completed'),
                v_payment->>'provider_reference',
                COALESCE((v_payment->>'created_at')::TIMESTAMPTZ, NOW()),
                NOW()
            )
            ON CONFLICT (id) DO NOTHING;
        END LOOP;
    END IF;

    -- Insert Inventory Movements & Deduct Stock
    IF p_movements IS NOT NULL AND jsonb_typeof(p_movements) = 'array' THEN
        FOR v_movement IN SELECT * FROM jsonb_array_elements(p_movements)
        LOOP
            v_product_id := (v_movement->>'product_id')::UUID;
            v_qty := (v_movement->>'quantity')::NUMERIC(12, 2);

            IF v_product_id IS NOT NULL AND v_qty IS NOT NULL THEN
                INSERT INTO public.inventory_movements (
                    id,
                    store_id,
                    product_id,
                    type,
                    quantity,
                    reference_type,
                    reference_id,
                    user_id,
                    terminal_id,
                    notes,
                    created_at
                ) VALUES (
                    COALESCE((v_movement->>'id')::UUID, gen_random_uuid()),
                    v_store_id,
                    v_product_id,
                    COALESCE(v_movement->>'type', 'sale'),
                    v_qty,
                    COALESCE(v_movement->>'reference_type', 'SALE'),
                    COALESCE(v_movement->>'reference_id', v_sale_id::TEXT),
                    CASE WHEN (v_movement->>'user_id') IS NOT NULL AND length(v_movement->>'user_id') = 36 THEN (v_movement->>'user_id')::UUID ELSE NULL END,
                    CASE WHEN (v_movement->>'terminal_id') IS NOT NULL AND length(v_movement->>'terminal_id') = 36 THEN (v_movement->>'terminal_id')::UUID ELSE NULL END,
                    v_movement->>'notes',
                    COALESCE((v_movement->>'created_at')::TIMESTAMPTZ, NOW())
                )
                ON CONFLICT (id) DO NOTHING;

                INSERT INTO public.inventory (store_id, product_id, quantity, updated_at)
                VALUES (v_store_id, v_product_id, v_qty, NOW())
                ON CONFLICT (store_id, product_id)
                DO UPDATE SET
                    quantity = public.inventory.quantity + EXCLUDED.quantity,
                    updated_at = NOW();
            END IF;
        END LOOP;
    END IF;

    -- Record in sync_events for server-side idempotency
    IF p_client_event_id IS NOT NULL THEN
        INSERT INTO public.sync_events (
            client_event_id,
            store_id,
            entity_type,
            entity_id,
            operation,
            payload,
            status,
            processed_at
        ) VALUES (
            p_client_event_id,
            v_store_id,
            'sale',
            v_sale_id::TEXT,
            'INSERT',
            jsonb_build_object('sale_id', v_sale_id),
            'PROCESSED',
            NOW()
        )
        ON CONFLICT (client_event_id)
        DO UPDATE SET
            status = 'PROCESSED',
            processed_at = NOW();
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'SYNCED',
        'sale_id', v_sale_id
    );
END;
$$;

-- 2. process_sale_atomic: Direct alias procedure matching verification test suite
CREATE OR REPLACE FUNCTION public.process_sale_atomic(
    p_sale JSONB,
    p_items JSONB,
    p_payments JSONB,
    p_movements JSONB DEFAULT '[]'::jsonb,
    p_client_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.sync_process_sale(p_sale, p_items, p_payments, p_movements, p_client_event_id);
END;
$$;

-- 3. record_inventory_movement_atomic: Atomic inventory stock adjustment
CREATE OR REPLACE FUNCTION public.record_inventory_movement_atomic(
    p_movement JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_movement_id UUID;
    v_store_id UUID;
    v_product_id UUID;
    v_qty NUMERIC(12, 2);
    v_type TEXT;
BEGIN
    v_movement_id := COALESCE((p_movement->>'id')::UUID, gen_random_uuid());
    v_store_id := (p_movement->>'store_id')::UUID;
    v_product_id := (p_movement->>'product_id')::UUID;
    v_qty := (p_movement->>'quantity')::NUMERIC(12, 2);
    v_type := COALESCE(p_movement->>'type', 'adjustment');

    IF v_store_id IS NULL OR v_product_id IS NULL OR v_qty IS NULL THEN
        RAISE EXCEPTION 'Missing store_id, product_id, or quantity';
    END IF;

    -- Security Authorization Check:
    -- Fail-closed: Anonymous callers cannot alter inventory; authenticated callers must possess a valid store membership and belong to the target store.
    IF auth.role() = 'anon' THEN
        RAISE EXCEPTION 'Access denied: anonymous callers cannot record inventory movements';
    END IF;
    IF auth.uid() IS NOT NULL THEN
        IF auth_user_store_id() IS NULL THEN
            RAISE EXCEPTION 'Access denied: authenticated caller has no assigned store membership';
        END IF;
        IF auth_user_store_id() <> v_store_id THEN
            RAISE EXCEPTION 'Cross-store access denied: caller does not belong to store %', v_store_id;
        END IF;
    END IF;

    INSERT INTO public.inventory_movements (
        id, store_id, product_id, type, quantity, reference_type, reference_id, user_id, terminal_id, notes, created_at
    ) VALUES (
        v_movement_id,
        v_store_id,
        v_product_id,
        v_type,
        v_qty,
        p_movement->>'reference_type',
        p_movement->>'reference_id',
        CASE WHEN (p_movement->>'user_id') IS NOT NULL AND length(p_movement->>'user_id') = 36 THEN (p_movement->>'user_id')::UUID ELSE NULL END,
        CASE WHEN (p_movement->>'terminal_id') IS NOT NULL AND length(p_movement->>'terminal_id') = 36 THEN (p_movement->>'terminal_id')::UUID ELSE NULL END,
        p_movement->>'notes',
        COALESCE((p_movement->>'created_at')::TIMESTAMPTZ, NOW())
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.inventory (store_id, product_id, quantity, updated_at)
    VALUES (v_store_id, v_product_id, v_qty, NOW())
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET
        quantity = public.inventory.quantity + EXCLUDED.quantity,
        updated_at = NOW();

    RETURN jsonb_build_object('success', true, 'movement_id', v_movement_id);
END;
$$;

-- 4. sync_process_cash_shift: Atomic shift open/close & float cash movements
CREATE OR REPLACE FUNCTION public.sync_process_cash_shift(
    p_shift JSONB,
    p_movements JSONB DEFAULT NULL,
    p_client_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_shift_id UUID;
    v_store_id UUID;
    v_movement JSONB;
BEGIN
    v_shift_id := (p_shift->>'id')::UUID;
    v_store_id := (p_shift->>'store_id')::UUID;

    IF v_shift_id IS NULL OR v_store_id IS NULL THEN
        RAISE EXCEPTION 'Missing shift id or store_id';
    END IF;

    -- Security Authorization Check:
    -- Fail-closed: Anonymous callers cannot manage cash shifts; authenticated callers must possess a valid store membership and belong to the target store.
    IF auth.role() = 'anon' THEN
        RAISE EXCEPTION 'Access denied: anonymous callers cannot process cash shifts';
    END IF;
    IF auth.uid() IS NOT NULL THEN
        IF auth_user_store_id() IS NULL THEN
            RAISE EXCEPTION 'Access denied: authenticated caller has no assigned store membership';
        END IF;
        IF auth_user_store_id() <> v_store_id THEN
            RAISE EXCEPTION 'Cross-store access denied: caller does not belong to store %', v_store_id;
        END IF;
    END IF;

    INSERT INTO public.cash_shifts (
        id,
        store_id,
        terminal_id,
        user_id,
        opening_amount,
        closing_amount,
        expected_amount,
        difference,
        status,
        opened_at,
        closed_at
    ) VALUES (
        v_shift_id,
        v_store_id,
        CASE WHEN (p_shift->>'terminal_id') IS NOT NULL AND length(p_shift->>'terminal_id') = 36 THEN (p_shift->>'terminal_id')::UUID ELSE NULL END,
        CASE WHEN (p_shift->>'user_id') IS NOT NULL AND length(p_shift->>'user_id') = 36 THEN (p_shift->>'user_id')::UUID ELSE NULL END,
        (p_shift->>'opening_amount')::NUMERIC(12, 2),
        CASE WHEN (p_shift->>'closing_amount') IS NOT NULL THEN (p_shift->>'closing_amount')::NUMERIC(12, 2) ELSE NULL END,
        CASE WHEN (p_shift->>'expected_amount') IS NOT NULL THEN (p_shift->>'expected_amount')::NUMERIC(12, 2) ELSE NULL END,
        CASE WHEN (p_shift->>'difference') IS NOT NULL THEN (p_shift->>'difference')::NUMERIC(12, 2) ELSE NULL END,
        COALESCE(p_shift->>'status', 'open'),
        COALESCE((p_shift->>'opened_at')::TIMESTAMPTZ, NOW()),
        CASE WHEN (p_shift->>'closed_at') IS NOT NULL THEN (p_shift->>'closed_at')::TIMESTAMPTZ ELSE NULL END
    )
    ON CONFLICT (id) DO UPDATE SET
        closing_amount = EXCLUDED.closing_amount,
        expected_amount = EXCLUDED.expected_amount,
        difference = EXCLUDED.difference,
        status = EXCLUDED.status,
        closed_at = EXCLUDED.closed_at;

    IF p_movements IS NOT NULL AND jsonb_typeof(p_movements) = 'array' THEN
        FOR v_movement IN SELECT * FROM jsonb_array_elements(p_movements)
        LOOP
            INSERT INTO public.cash_movements (
                id,
                shift_id,
                type,
                amount,
                reason,
                user_id,
                created_at
            ) VALUES (
                COALESCE((v_movement->>'id')::UUID, gen_random_uuid()),
                v_shift_id,
                v_movement->>'type',
                (v_movement->>'amount')::NUMERIC(12, 2),
                v_movement->>'reason',
                CASE WHEN (v_movement->>'user_id') IS NOT NULL AND length(v_movement->>'user_id') = 36 THEN (v_movement->>'user_id')::UUID ELSE NULL END,
                COALESCE((v_movement->>'created_at')::TIMESTAMPTZ, NOW())
            )
            ON CONFLICT (id) DO NOTHING;
        END LOOP;
    END IF;

    IF p_client_event_id IS NOT NULL THEN
        INSERT INTO public.sync_events (
            client_event_id,
            store_id,
            entity_type,
            entity_id,
            operation,
            payload,
            status,
            processed_at
        ) VALUES (
            p_client_event_id,
            v_store_id,
            'cash_shift',
            v_shift_id::TEXT,
            'UPSERT',
            jsonb_build_object('shift_id', v_shift_id),
            'PROCESSED',
            NOW()
        )
        ON CONFLICT (client_event_id)
        DO UPDATE SET
            status = 'PROCESSED',
            processed_at = NOW();
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'SYNCED',
        'shift_id', v_shift_id
    );
END;
$$;

-- 5. open_cash_shift_atomic: Specific procedure for opening cash shift
CREATE OR REPLACE FUNCTION public.open_cash_shift_atomic(
    p_shift JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.sync_process_cash_shift(p_shift, '[]'::jsonb, p_shift->>'client_event_id');
END;
$$;

-- 6. close_cash_shift_atomic: Specific procedure for closing cash shift
CREATE OR REPLACE FUNCTION public.close_cash_shift_atomic(
    p_shift JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.sync_process_cash_shift(p_shift, '[]'::jsonb, p_shift->>'client_event_id');
END;
$$;

-- 7. sync_pull_changes: Incremental pull RPC supporting tombstones and cursor tracking
CREATE OR REPLACE FUNCTION public.sync_pull_changes(
    p_store_id UUID,
    p_entity_type TEXT,
    p_cursor TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (data JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Security Authorization Check:
    -- Fail-closed: Anonymous callers cannot pull store data; authenticated callers must possess a valid store membership and belong to the target store.
    IF auth.role() = 'anon' THEN
        RAISE EXCEPTION 'Access denied: anonymous callers cannot pull store changes';
    END IF;
    IF auth.uid() IS NOT NULL THEN
        IF auth_user_store_id() IS NULL THEN
            RAISE EXCEPTION 'Access denied: authenticated caller has no assigned store membership';
        END IF;
        IF auth_user_store_id() <> p_store_id THEN
            RAISE EXCEPTION 'Cross-store access denied: caller does not belong to store %', p_store_id;
        END IF;
    END IF;

    IF p_entity_type = 'categories' THEN
        RETURN QUERY
        SELECT to_jsonb(c) FROM public.categories c
        WHERE c.store_id = p_store_id
          AND (p_cursor IS NULL OR c.updated_at > p_cursor)
        ORDER BY c.updated_at ASC;

    ELSIF p_entity_type = 'products' THEN
        RETURN QUERY
        SELECT to_jsonb(p) FROM public.products p
        WHERE p.store_id = p_store_id
          AND (p_cursor IS NULL OR p.updated_at > p_cursor)
        ORDER BY p.updated_at ASC;

    ELSIF p_entity_type = 'taxes' THEN
        RETURN QUERY
        SELECT to_jsonb(t) FROM public.taxes t
        WHERE t.store_id = p_store_id
          AND (p_cursor IS NULL OR t.updated_at > p_cursor)
        ORDER BY t.updated_at ASC;

    ELSIF p_entity_type = 'customers' THEN
        RETURN QUERY
        SELECT to_jsonb(cust) FROM public.customers cust
        WHERE cust.store_id = p_store_id
          AND (p_cursor IS NULL OR cust.updated_at > p_cursor)
        ORDER BY cust.updated_at ASC;

    ELSIF p_entity_type = 'printers' THEN
        RETURN QUERY
        SELECT to_jsonb(pr) FROM public.printers pr
        WHERE pr.store_id = p_store_id
          AND (p_cursor IS NULL OR pr.updated_at > p_cursor)
        ORDER BY pr.updated_at ASC;

    ELSIF p_entity_type = 'store_settings' THEN
        RETURN QUERY
        SELECT to_jsonb(ss) FROM public.store_settings ss
        WHERE ss.store_id = p_store_id
          AND (p_cursor IS NULL OR ss.updated_at > p_cursor)
        ORDER BY ss.updated_at ASC;

    ELSIF p_entity_type = 'user_profiles' THEN
        RETURN QUERY
        SELECT to_jsonb(up) FROM public.user_profiles up
        WHERE up.store_id = p_store_id
          AND (p_cursor IS NULL OR up.updated_at > p_cursor)
        ORDER BY up.updated_at ASC;
    END IF;
END;
$$;

-- 8. sync_backend_health: Backend health diagnostic RPC
CREATE OR REPLACE FUNCTION public.sync_backend_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN jsonb_build_object(
        'status', 'ok',
        'database', 'connected',
        'server_time', NOW(),
        'migration_version', 'phase4a_consolidated',
        'caller_user_id', auth.uid(),
        'caller_store_id', public.auth_user_store_id()
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- STEP 9: PERMISSIONS, GRANTS & POSTGREST SCHEMA CACHE REFRESH
-- ------------------------------------------------------------------------------
-- Basic schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Operational data tables access (authenticated POS users only; anon restricted)
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Sequences access (authenticated POS users only)
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Revoke function execution privileges from PUBLIC and anon
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;

-- Grant execution of individually reviewed procedures strictly to authenticated POS staff
GRANT EXECUTE ON FUNCTION public.sync_process_sale(JSONB, JSONB, JSONB, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_sale_atomic(JSONB, JSONB, JSONB, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_inventory_movement_atomic(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_process_cash_shift(JSONB, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_shift_atomic(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_shift_atomic(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_pull_changes(UUID, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_backend_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_store_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_has_permission(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_is_owner_or_admin() TO authenticated;

-- Allow anon strictly and solely on the diagnostic health check function
GRANT EXECUTE ON FUNCTION public.sync_backend_health() TO anon;

-- Default privileges for future database objects: deny routine execution by default
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon, authenticated;

-- Refresh PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';
