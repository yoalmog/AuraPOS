-- ==============================================================================
-- AuraPOS Supabase Migration: 20240523000001_core_schema.sql
-- Initial Schema for stores, terminals, roles, permissions, and user_profiles
-- Primary keys are UUIDs and foreign keys reference auth.users
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. STORES
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 2. TERMINALS (Hardware Cashier POS Terminals)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.terminals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    device_identifier TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_terminal_device UNIQUE(store_id, device_identifier)
);

-- ------------------------------------------------------------------------------
-- 3. ROLES & PERMISSIONS
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 4. USER PROFILES & USER ROLES (Linked with auth.users)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    phone TEXT,
    pin_hash TEXT, -- Securely hashed numeric PIN
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- ------------------------------------------------------------------------------
-- 5. SEED INITIAL ROLES AND SYSTEM PERMISSIONS
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
-- 6. INDEXES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_terminals_store ON public.terminals(store_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_store ON public.user_profiles(store_id);
