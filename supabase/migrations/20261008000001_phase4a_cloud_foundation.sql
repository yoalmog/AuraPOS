-- ==============================================================================
-- AuraPOS Supabase Migration: 20261008000001_phase4a_cloud_foundation.sql
-- Phase 4A: Production Supabase Cloud Foundation
-- Conforming to Steps 4-17, 20, 22, 23 of AuraPOS Architecture:
-- 1. Schema reconciliation, soft deletes (tombstones), versioning & constraints
-- 2. Complete RLS policies for cash_shifts, cash_movements, taxes, translations
-- 3. Storage bucket configuration and store-isolated access policies
-- 4. Atomic PostgreSQL RPC functions for sales, cash shifts, inventory movements
-- 5. Incremental pull & cursor tracking RPCs
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SOFT DELETES (TOMBSTONES) & VERSIONING FOR MASTER DATA
-- ------------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

ALTER TABLE product_translations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

ALTER TABLE category_translations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

ALTER TABLE taxes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE taxes ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

ALTER TABLE printers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

ALTER TABLE terminals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE terminals ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- ------------------------------------------------------------------------------
-- 2. SYNC CURSORS & SYNC EVENTS EXTENSION
-- ------------------------------------------------------------------------------
-- Ensure sync_cursors can be scoped to store_id or terminal_id
ALTER TABLE sync_cursors ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sync_cursors_store_entity ON sync_cursors(store_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_categories_updated_at ON categories(updated_at);
CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers(updated_at);
CREATE INDEX IF NOT EXISTS idx_taxes_updated_at ON taxes(updated_at);
CREATE INDEX IF NOT EXISTS idx_printers_updated_at ON printers(updated_at);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_store ON cash_shifts(store_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON cash_movements(shift_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_store_status ON sync_events(store_id, status);

-- ------------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) POLICIES FOR PREVIOUSLY MISSING TABLES
-- ------------------------------------------------------------------------------

-- Taxes Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'taxes' AND policyname = 'Users can view taxes in their store'
    ) THEN
        CREATE POLICY "Users can view taxes in their store"
            ON taxes FOR SELECT
            USING (store_id = auth_user_store_id());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'taxes' AND policyname = 'Managers can manage taxes'
    ) THEN
        CREATE POLICY "Managers can manage taxes"
            ON taxes FOR ALL
            USING (store_id = auth_user_store_id() AND auth_user_has_permission('settings.manage'));
    END IF;
END $$;

-- Cash Shifts Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'cash_shifts' AND policyname = 'Users can view cash shifts in their store'
    ) THEN
        CREATE POLICY "Users can view cash shifts in their store"
            ON cash_shifts FOR SELECT
            USING (store_id = auth_user_store_id());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'cash_shifts' AND policyname = 'Cashiers can insert cash shifts'
    ) THEN
        CREATE POLICY "Cashiers can insert cash shifts"
            ON cash_shifts FOR INSERT
            WITH CHECK (store_id = auth_user_store_id() AND auth_user_has_permission('pos.view'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'cash_shifts' AND policyname = 'Staff can update cash shifts'
    ) THEN
        CREATE POLICY "Staff can update cash shifts"
            ON cash_shifts FOR UPDATE
            USING (store_id = auth_user_store_id() AND (auth_user_has_permission('pos.view') OR auth_user_has_permission('settings.manage')));
    END IF;
END $$;

-- Cash Movements Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'cash_movements' AND policyname = 'Users can view cash movements'
    ) THEN
        CREATE POLICY "Users can view cash movements"
            ON cash_movements FOR SELECT
            USING (shift_id IN (SELECT id FROM cash_shifts WHERE store_id = auth_user_store_id()));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'cash_movements' AND policyname = 'Cashiers can insert cash movements'
    ) THEN
        CREATE POLICY "Cashiers can insert cash movements"
            ON cash_movements FOR INSERT
            WITH CHECK (shift_id IN (SELECT id FROM cash_shifts WHERE store_id = auth_user_store_id()) AND auth_user_has_permission('pos.view'));
    END IF;
END $$;

-- Product Translations Management Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'product_translations' AND policyname = 'Staff can manage product translations'
    ) THEN
        CREATE POLICY "Staff can manage product translations"
            ON product_translations FOR ALL
            USING (product_id IN (SELECT id FROM products WHERE store_id = auth_user_store_id())
                   AND auth_user_has_permission('product.edit'));
    END IF;
END $$;

-- Inventory Adjustment / Update Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'inventory' AND policyname = 'Staff can update inventory quantities'
    ) THEN
        CREATE POLICY "Staff can update inventory quantities"
            ON inventory FOR ALL
            USING (store_id = auth_user_store_id() AND (
                auth_user_has_permission('inventory.adjust') OR
                auth_user_has_permission('pos.sell')
            ));
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. SUPABASE STORAGE BUCKET & POLICIES (Step 17)
-- ------------------------------------------------------------------------------
-- Create media bucket for product images, receipts, and brand logos
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

-- Storage RLS: Ensure bucket objects are store-isolated
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Store staff can read aurapos media'
    ) THEN
        CREATE POLICY "Store staff can read aurapos media"
            ON storage.objects FOR SELECT
            USING (
                bucket_id = 'aurapos-media' AND
                auth.role() = 'authenticated' AND
                (storage.foldername(name))[1] = auth_user_store_id()::TEXT
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Store staff can upload aurapos media'
    ) THEN
        CREATE POLICY "Store staff can upload aurapos media"
            ON storage.objects FOR INSERT
            WITH CHECK (
                bucket_id = 'aurapos-media' AND
                auth.role() = 'authenticated' AND
                (storage.foldername(name))[1] = auth_user_store_id()::TEXT
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Store staff can delete aurapos media'
    ) THEN
        CREATE POLICY "Store staff can delete aurapos media"
            ON storage.objects FOR DELETE
            USING (
                bucket_id = 'aurapos-media' AND
                auth.role() = 'authenticated' AND
                (storage.foldername(name))[1] = auth_user_store_id()::TEXT
            );
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. ATOMIC SALES SYNCHRONIZATION RPC (Step 13 & Step 14)
-- Enforces complete atomicity across sales, sale_items, payments,
-- inventory_movements, and stock adjustments with idempotency deduplication.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_process_sale(
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
    -- 1. Idempotency Check via client_event_id
    IF p_client_event_id IS NOT NULL THEN
        SELECT * INTO v_event_record FROM sync_events WHERE client_event_id = p_client_event_id;
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
    SELECT id INTO v_existing_sale_id FROM sales WHERE id = v_sale_id;
    IF v_existing_sale_id IS NOT NULL THEN
        -- Return already processed to ensure idempotent retry
        RETURN jsonb_build_object(
            'success', true,
            'status', 'ALREADY_EXISTS',
            'sale_id', v_sale_id
        );
    END IF;

    -- 2. Insert Sale Header
    INSERT INTO sales (
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

    -- 3. Insert Sale Items
    IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            INSERT INTO sale_items (
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

    -- 4. Insert Payments
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' THEN
        FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
        LOOP
            INSERT INTO payments (
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

    -- 5. Insert Inventory Movements & Atomically Update Stock Ledger
    IF p_movements IS NOT NULL AND jsonb_typeof(p_movements) = 'array' THEN
        FOR v_movement IN SELECT * FROM jsonb_array_elements(p_movements)
        LOOP
            v_product_id := (v_movement->>'product_id')::UUID;
            v_qty := (v_movement->>'quantity')::NUMERIC(12, 2);

            IF v_product_id IS NOT NULL AND v_qty IS NOT NULL THEN
                INSERT INTO inventory_movements (
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

                -- Atomically update current stock in inventory table
                -- For sales, quantity in movements is typically negative or represents deduction
                INSERT INTO inventory (store_id, product_id, quantity, updated_at)
                VALUES (v_store_id, v_product_id, v_qty, NOW())
                ON CONFLICT (store_id, product_id)
                DO UPDATE SET
                    quantity = inventory.quantity + EXCLUDED.quantity,
                    updated_at = NOW();
            END IF;
        END LOOP;
    END IF;

    -- 6. Record in sync_events to guarantee server-side idempotency
    IF p_client_event_id IS NOT NULL THEN
        INSERT INTO sync_events (
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

-- Alias for process_sale_atomic (conforming to verification test suite)
CREATE OR REPLACE FUNCTION process_sale_atomic(
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
    RETURN sync_process_sale(p_sale, p_items, p_payments, p_movements, p_client_event_id);
END;
$$;

-- Atomic inventory movement recording
CREATE OR REPLACE FUNCTION record_inventory_movement_atomic(
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

    INSERT INTO inventory_movements (
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

    INSERT INTO inventory (store_id, product_id, quantity, updated_at)
    VALUES (v_store_id, v_product_id, v_qty, NOW())
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET
        quantity = inventory.quantity + EXCLUDED.quantity,
        updated_at = NOW();

    RETURN jsonb_build_object('success', true, 'movement_id', v_movement_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. ATOMIC CASH SHIFT & MOVEMENTS SYNCHRONIZATION RPC (Step 15)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_process_cash_shift(
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

    -- Upsert Cash Shift Header
    INSERT INTO cash_shifts (
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

    -- Upsert Associated Float Movements
    IF p_movements IS NOT NULL AND jsonb_typeof(p_movements) = 'array' THEN
        FOR v_movement IN SELECT * FROM jsonb_array_elements(p_movements)
        LOOP
            INSERT INTO cash_movements (
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

    -- Idempotency event tracking
    IF p_client_event_id IS NOT NULL THEN
        INSERT INTO sync_events (
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

-- Alias for open_cash_shift_atomic (conforming to verification test suite)
CREATE OR REPLACE FUNCTION open_cash_shift_atomic(
    p_shift JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN sync_process_cash_shift(p_shift, '[]'::jsonb, p_shift->>'client_event_id');
END;
$$;

-- Alias for close_cash_shift_atomic (conforming to verification test suite)
CREATE OR REPLACE FUNCTION close_cash_shift_atomic(
    p_shift JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN sync_process_cash_shift(p_shift, '[]'::jsonb, p_shift->>'client_event_id');
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. INCREMENTAL PULL RPC (Step 10 & Step 11)
-- Returns records updated after the cursor checkpoint, including tombstones
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_pull_changes(
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
        SELECT to_jsonb(c) FROM categories c
        WHERE c.store_id = p_store_id
          AND (p_cursor IS NULL OR c.updated_at > p_cursor)
        ORDER BY c.updated_at ASC;

    ELSIF p_entity_type = 'products' THEN
        RETURN QUERY
        SELECT to_jsonb(p) FROM products p
        WHERE p.store_id = p_store_id
          AND (p_cursor IS NULL OR p.updated_at > p_cursor)
        ORDER BY p.updated_at ASC;

    ELSIF p_entity_type = 'taxes' THEN
        RETURN QUERY
        SELECT to_jsonb(t) FROM taxes t
        WHERE t.store_id = p_store_id
          AND (p_cursor IS NULL OR t.updated_at > p_cursor)
        ORDER BY t.updated_at ASC;

    ELSIF p_entity_type = 'customers' THEN
        RETURN QUERY
        SELECT to_jsonb(cust) FROM customers cust
        WHERE cust.store_id = p_store_id
          AND (p_cursor IS NULL OR cust.updated_at > p_cursor)
        ORDER BY cust.updated_at ASC;

    ELSIF p_entity_type = 'printers' THEN
        RETURN QUERY
        SELECT to_jsonb(pr) FROM printers pr
        WHERE pr.store_id = p_store_id
          AND (p_cursor IS NULL OR pr.updated_at > p_cursor)
        ORDER BY pr.updated_at ASC;

    ELSIF p_entity_type = 'store_settings' THEN
        RETURN QUERY
        SELECT to_jsonb(ss) FROM store_settings ss
        WHERE ss.store_id = p_store_id
          AND (p_cursor IS NULL OR ss.updated_at > p_cursor)
        ORDER BY ss.updated_at ASC;

    ELSIF p_entity_type = 'user_profiles' THEN
        RETURN QUERY
        SELECT to_jsonb(up) FROM user_profiles up
        WHERE up.store_id = p_store_id
          AND (p_cursor IS NULL OR up.updated_at > p_cursor)
        ORDER BY up.updated_at ASC;
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. BACKEND HEALTH RPC (Step 18)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_backend_health()
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
        'migration_version', '20261008000001_phase4a_cloud_foundation',
        'caller_user_id', auth.uid(),
        'caller_store_id', auth_user_store_id()
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. PERMISSIONS, GRANTS & POSTGREST SCHEMA CACHE REFRESH
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

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';

