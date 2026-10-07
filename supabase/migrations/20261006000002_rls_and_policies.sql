-- ==============================================================================
-- AuraPOS Supabase Migration 002: Row Level Security (RLS) & Authorization
-- Conforming to Requirements 5, 6, 28, and 29
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SECURITY HELPER FUNCTIONS
-- ------------------------------------------------------------------------------

-- Get current authenticated user's store_id
CREATE OR REPLACE FUNCTION auth_user_store_id()
RETURNS UUID AS $$
  SELECT store_id FROM user_profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Check if current authenticated user has a specific permission code
CREATE OR REPLACE FUNCTION auth_user_has_permission(permission_code TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid()
      AND p.code = permission_code
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Check if current authenticated user is an OWNER or ADMIN
CREATE OR REPLACE FUNCTION auth_user_is_owner_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
      AND r.name IN ('OWNER', 'ADMIN')
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 2. ENABLE ROW LEVEL SECURITY ACROSS ALL TABLES
-- ------------------------------------------------------------------------------
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE printer_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. POLICIES: STORES
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view their authorized store"
    ON stores FOR SELECT
    USING (id = auth_user_store_id());

CREATE POLICY "Owners can update store configuration"
    ON stores FOR UPDATE
    USING (id = auth_user_store_id() AND auth_user_has_permission('stores.manage'));

-- ------------------------------------------------------------------------------
-- 4. POLICIES: TERMINALS
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view terminals in their store"
    ON terminals FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Managers can manage terminals"
    ON terminals FOR ALL
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('terminals.manage'));

-- ------------------------------------------------------------------------------
-- 5. POLICIES: USER PROFILES & ROLES
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view profiles in their store"
    ON user_profiles FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Managers can manage user profiles"
    ON user_profiles FOR ALL
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('users.manage'));

CREATE POLICY "Users can view roles and permissions"
    ON roles FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view permissions"
    ON permissions FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view role permissions"
    ON role_permissions FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view user roles in their store"
    ON user_roles FOR SELECT
    USING (user_id IN (SELECT id FROM user_profiles WHERE store_id = auth_user_store_id()));

-- ------------------------------------------------------------------------------
-- 6. POLICIES: CATEGORIES & TRANSLATIONS
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view categories in their store"
    ON categories FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Managers can manage categories"
    ON categories FOR INSERT
    WITH CHECK (store_id = auth_user_store_id() AND auth_user_has_permission('category.create'));

CREATE POLICY "Managers can update categories"
    ON categories FOR UPDATE
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('category.edit'));

CREATE POLICY "Managers can delete categories"
    ON categories FOR DELETE
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('category.delete'));

CREATE POLICY "Users can view category translations"
    ON category_translations FOR SELECT
    USING (category_id IN (SELECT id FROM categories WHERE store_id = auth_user_store_id()));

CREATE POLICY "Managers can manage category translations"
    ON category_translations FOR ALL
    USING (category_id IN (SELECT id FROM categories WHERE store_id = auth_user_store_id())
           AND auth_user_has_permission('category.edit'));

-- ------------------------------------------------------------------------------
-- 7. POLICIES: PRODUCTS, TRANSLATIONS & VARIANTS
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view products in their store"
    ON products FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Authorized staff can insert products"
    ON products FOR INSERT
    WITH CHECK (store_id = auth_user_store_id() AND auth_user_has_permission('product.create'));

CREATE POLICY "Authorized staff can update products"
    ON products FOR UPDATE
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('product.edit'));

CREATE POLICY "Authorized staff can delete products"
    ON products FOR DELETE
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('product.delete'));

CREATE POLICY "Users can view product variants"
    ON product_variants FOR SELECT
    USING (product_id IN (SELECT id FROM products WHERE store_id = auth_user_store_id()));

CREATE POLICY "Authorized staff can manage product variants"
    ON product_variants FOR ALL
    USING (product_id IN (SELECT id FROM products WHERE store_id = auth_user_store_id())
           AND auth_user_has_permission('product.edit'));

CREATE POLICY "Users can view product translations"
    ON product_translations FOR SELECT
    USING (product_id IN (SELECT id FROM products WHERE store_id = auth_user_store_id()));

-- ------------------------------------------------------------------------------
-- 8. POLICIES: CUSTOMERS
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view customers in their store"
    ON customers FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Authorized staff can create customers"
    ON customers FOR INSERT
    WITH CHECK (store_id = auth_user_store_id() AND auth_user_has_permission('customer.create'));

CREATE POLICY "Authorized staff can update customers"
    ON customers FOR UPDATE
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('customer.edit'));

-- ------------------------------------------------------------------------------
-- 9. POLICIES: SALES, SALE ITEMS & PAYMENTS
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view sales in their store"
    ON sales FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Cashiers can insert sales"
    ON sales FOR INSERT
    WITH CHECK (store_id = auth_user_store_id() AND auth_user_has_permission('pos.sell'));

CREATE POLICY "Staff can update sales status (refund/void)"
    ON sales FOR UPDATE
    USING (store_id = auth_user_store_id() AND (auth_user_has_permission('sales.refund') OR auth_user_has_permission('pos.void')));

CREATE POLICY "Users can view sale items"
    ON sale_items FOR SELECT
    USING (sale_id IN (SELECT id FROM sales WHERE store_id = auth_user_store_id()));

CREATE POLICY "Cashiers can insert sale items"
    ON sale_items FOR INSERT
    WITH CHECK (sale_id IN (SELECT id FROM sales WHERE store_id = auth_user_store_id()));

CREATE POLICY "Users can view payments"
    ON payments FOR SELECT
    USING (sale_id IN (SELECT id FROM sales WHERE store_id = auth_user_store_id()));

CREATE POLICY "Cashiers can insert payments"
    ON payments FOR INSERT
    WITH CHECK (sale_id IN (SELECT id FROM sales WHERE store_id = auth_user_store_id()));

CREATE POLICY "Users can view refunds"
    ON refunds FOR SELECT
    USING (sale_id IN (SELECT id FROM sales WHERE store_id = auth_user_store_id()));

CREATE POLICY "Authorized staff can insert refunds"
    ON refunds FOR INSERT
    WITH CHECK (sale_id IN (SELECT id FROM sales WHERE store_id = auth_user_store_id())
                AND auth_user_has_permission('pos.refund'));

-- ------------------------------------------------------------------------------
-- 10. POLICIES: INVENTORY & MOVEMENTS
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view inventory in their store"
    ON inventory FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Users can view inventory movements"
    ON inventory_movements FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Authorized staff can insert inventory movements"
    ON inventory_movements FOR INSERT
    WITH CHECK (store_id = auth_user_store_id() AND (
        auth_user_has_permission('inventory.adjust') OR
        auth_user_has_permission('pos.sell') OR
        auth_user_has_permission('pos.refund')
    ));

-- ------------------------------------------------------------------------------
-- 11. POLICIES: PRINTERS & PRINT JOBS
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view printers in their store"
    ON printers FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Managers can manage printers"
    ON printers FOR ALL
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('printers.manage'));

CREATE POLICY "Users can view printer routes"
    ON printer_routes FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Managers can manage printer routes"
    ON printer_routes FOR ALL
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('printers.manage'));

CREATE POLICY "Users can view print jobs in their store"
    ON print_jobs FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Terminals can manage print jobs"
    ON print_jobs FOR ALL
    USING (store_id = auth_user_store_id());

-- ------------------------------------------------------------------------------
-- 12. POLICIES: STORE SETTINGS & AUDIT LOGS
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view store settings"
    ON store_settings FOR SELECT
    USING (store_id = auth_user_store_id());

CREATE POLICY "Owners can update store settings"
    ON store_settings FOR ALL
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('settings.manage'));

CREATE POLICY "Users can view audit logs"
    ON audit_logs FOR SELECT
    USING (store_id = auth_user_store_id() AND auth_user_has_permission('audit.view'));

CREATE POLICY "System can append audit logs"
    ON audit_logs FOR INSERT
    WITH CHECK (store_id = auth_user_store_id());

-- ------------------------------------------------------------------------------
-- 13. POLICIES: SYNC EVENTS
-- ------------------------------------------------------------------------------
CREATE POLICY "Terminals can view and append sync events"
    ON sync_events FOR ALL
    USING (store_id = auth_user_store_id());

CREATE POLICY "Terminals can view and update sync cursors"
    ON sync_cursors FOR ALL
    USING (terminal_id IN (SELECT id FROM terminals WHERE store_id = auth_user_store_id()));
