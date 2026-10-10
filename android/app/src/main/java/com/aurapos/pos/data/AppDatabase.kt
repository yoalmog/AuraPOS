package com.aurapos.pos.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.aurapos.pos.data.dao.*
import com.aurapos.pos.data.entity.*

/**
 * AuraPOS Master Room Database
 * Conforming to Section 3 & Section 35:
 * - Room + SQLite persistent architecture
 * - Survives process restart, device restart, network outage
 * - Explicit Room Migration from v1 to v2 without data destruction
 */
@Database(
    entities = [
        StoreEntity::class,
        TerminalEntity::class,
        RoleEntity::class,
        PermissionEntity::class,
        RolePermissionEntity::class,
        UserProfileEntity::class,
        CategoryEntity::class,
        CategoryTranslationEntity::class,
        TaxEntity::class,
        ProductEntity::class,
        ProductTranslationEntity::class,
        ProductVariantEntity::class,
        CustomerEntity::class,
        SaleEntity::class,
        SaleItemEntity::class,
        PaymentEntity::class,
        RefundEntity::class,
        InventoryEntity::class,
        InventoryMovementEntity::class,
        CashShiftEntity::class,
        CashMovementEntity::class,
        PrinterEntity::class,
        PrintJobEntity::class,
        SyncEventEntity::class,
        SyncCursorEntity::class,
        AuditLogEntity::class,
        StoreSettingsEntity::class
    ],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun productDao(): ProductDao
    abstract fun categoryDao(): CategoryDao
    abstract fun customerDao(): CustomerDao
    abstract fun saleDao(): SaleDao
    abstract fun inventoryDao(): InventoryDao
    abstract fun syncDao(): SyncDao
    abstract fun cashShiftDao(): CashShiftDao
    abstract fun printerDao(): PrinterDao
    abstract fun storeSettingsDao(): StoreSettingsDao
    abstract fun auditDao(): AuditDao

    companion object {
        const val DATABASE_NAME = "aurapos_pos.db"

        @Volatile
        private var INSTANCE: AppDatabase? = null

        /**
         * Migration 1 -> 2:
         * Upgrades the existing SQLiteOpenHelper v1 database to Room v2 without losing data.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // 1. Create missing tables if not already present
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS stores (
                        id TEXT PRIMARY KEY NOT NULL,
                        name TEXT NOT NULL,
                        legal_name TEXT,
                        address TEXT NOT NULL DEFAULT '{}',
                        phone TEXT,
                        email TEXT,
                        currency TEXT NOT NULL DEFAULT '$',
                        timezone TEXT NOT NULL DEFAULT 'UTC',
                        default_locale TEXT NOT NULL DEFAULT 'en',
                        tax_number TEXT,
                        logo_url TEXT,
                        is_active INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS terminals (
                        id TEXT PRIMARY KEY NOT NULL,
                        store_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        device_identifier TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'active',
                        last_seen_at TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_terminals_store_id_device_identifier ON terminals(store_id, device_identifier)")

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS roles (
                        id TEXT PRIMARY KEY NOT NULL,
                        name TEXT NOT NULL,
                        description TEXT,
                        created_at TEXT NOT NULL
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS permissions (
                        id TEXT PRIMARY KEY NOT NULL,
                        code TEXT NOT NULL,
                        module TEXT NOT NULL,
                        description TEXT,
                        created_at TEXT NOT NULL
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS role_permissions (
                        role_id TEXT NOT NULL,
                        permission_id TEXT NOT NULL,
                        PRIMARY KEY(role_id, permission_id)
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS user_profiles (
                        id TEXT PRIMARY KEY NOT NULL,
                        store_id TEXT NOT NULL,
                        display_name TEXT NOT NULL,
                        phone TEXT,
                        pin_hash TEXT,
                        is_active INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS category_translations (
                        id TEXT PRIMARY KEY NOT NULL,
                        category_id TEXT NOT NULL,
                        locale TEXT NOT NULL,
                        name TEXT NOT NULL,
                        description TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_category_translations_category_id_locale ON category_translations(category_id, locale)")

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS taxes (
                        id TEXT PRIMARY KEY NOT NULL,
                        store_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        rate REAL NOT NULL,
                        inclusive INTEGER NOT NULL DEFAULT 0,
                        is_active INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS product_translations (
                        id TEXT PRIMARY KEY NOT NULL,
                        product_id TEXT NOT NULL,
                        locale TEXT NOT NULL,
                        name TEXT NOT NULL,
                        description TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS product_variants (
                        id TEXT PRIMARY KEY NOT NULL,
                        product_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        sku TEXT,
                        barcode TEXT,
                        price REAL NOT NULL,
                        cost REAL NOT NULL DEFAULT 0,
                        attributes TEXT NOT NULL DEFAULT '{}',
                        is_active INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS refunds (
                        id TEXT PRIMARY KEY NOT NULL,
                        sale_id TEXT NOT NULL,
                        user_id TEXT,
                        amount REAL NOT NULL,
                        reason TEXT,
                        status TEXT NOT NULL DEFAULT 'completed',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS inventory (
                        id TEXT PRIMARY KEY NOT NULL,
                        store_id TEXT NOT NULL,
                        product_id TEXT NOT NULL,
                        quantity REAL NOT NULL DEFAULT 0,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_inventory_store_id_product_id ON inventory(store_id, product_id)")

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS inventory_movements (
                        id TEXT PRIMARY KEY NOT NULL,
                        store_id TEXT NOT NULL,
                        product_id TEXT NOT NULL,
                        type TEXT NOT NULL,
                        quantity REAL NOT NULL,
                        reference_type TEXT,
                        reference_id TEXT,
                        user_id TEXT,
                        terminal_id TEXT,
                        notes TEXT,
                        created_at TEXT NOT NULL,
                        sync_status TEXT NOT NULL DEFAULT 'PENDING_UPLOAD'
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS cash_shifts (
                        id TEXT PRIMARY KEY NOT NULL,
                        store_id TEXT NOT NULL,
                        terminal_id TEXT,
                        user_id TEXT,
                        opening_amount REAL NOT NULL DEFAULT 0,
                        closing_amount REAL,
                        expected_amount REAL,
                        difference REAL,
                        status TEXT NOT NULL DEFAULT 'open',
                        opened_at TEXT NOT NULL,
                        closed_at TEXT,
                        sync_status TEXT NOT NULL DEFAULT 'PENDING_UPLOAD'
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS cash_movements (
                        id TEXT PRIMARY KEY NOT NULL,
                        shift_id TEXT NOT NULL,
                        type TEXT NOT NULL,
                        amount REAL NOT NULL,
                        reason TEXT,
                        user_id TEXT,
                        created_at TEXT NOT NULL,
                        sync_status TEXT NOT NULL DEFAULT 'PENDING_UPLOAD'
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS sync_events (
                        id TEXT PRIMARY KEY NOT NULL,
                        client_event_id TEXT NOT NULL,
                        store_id TEXT NOT NULL,
                        terminal_id TEXT,
                        entity_type TEXT NOT NULL,
                        entity_id TEXT NOT NULL,
                        operation TEXT NOT NULL,
                        payload TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'PENDING',
                        attempts INTEGER NOT NULL DEFAULT 0,
                        error_message TEXT,
                        created_at TEXT NOT NULL,
                        processed_at TEXT
                    )
                """.trimIndent())
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_sync_events_client_event_id ON sync_events(client_event_id)")

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS sync_cursors (
                        id TEXT PRIMARY KEY NOT NULL,
                        terminal_id TEXT NOT NULL,
                        entity_type TEXT NOT NULL,
                        cursor TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_sync_cursors_terminal_id_entity_type ON sync_cursors(terminal_id, entity_type)")

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS audit_logs (
                        id TEXT PRIMARY KEY NOT NULL,
                        store_id TEXT NOT NULL,
                        user_id TEXT,
                        terminal_id TEXT,
                        action TEXT NOT NULL,
                        entity_type TEXT NOT NULL,
                        entity_id TEXT NOT NULL,
                        metadata TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL
                    )
                """.trimIndent())

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS store_settings (
                        id TEXT PRIMARY KEY NOT NULL,
                        store_id TEXT NOT NULL,
                        key TEXT NOT NULL,
                        value TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """.trimIndent())
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_store_settings_store_id_key ON store_settings(store_id, key)")

                // Add sync_status and metadata columns to existing tables if missing
                try {
                    db.execSQL("ALTER TABLE products ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'SYNCED'")
                } catch (_: Exception) {}
                try {
                    db.execSQL("ALTER TABLE products ADD COLUMN last_synced_at TEXT")
                } catch (_: Exception) {}

                try {
                    db.execSQL("ALTER TABLE categories ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'SYNCED'")
                } catch (_: Exception) {}
                try {
                    db.execSQL("ALTER TABLE categories ADD COLUMN last_synced_at TEXT")
                } catch (_: Exception) {}

                try {
                    db.execSQL("ALTER TABLE customers ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'SYNCED'")
                } catch (_: Exception) {}
                try {
                    db.execSQL("ALTER TABLE customers ADD COLUMN last_synced_at TEXT")
                } catch (_: Exception) {}

                try {
                    db.execSQL("ALTER TABLE sales ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'PENDING_UPLOAD'")
                } catch (_: Exception) {}
                try {
                    db.execSQL("ALTER TABLE sales ADD COLUMN client_created_at TEXT")
                } catch (_: Exception) {}
                try {
                    db.execSQL("ALTER TABLE sales ADD COLUMN last_synced_at TEXT")
                } catch (_: Exception) {}

                // Create required search indexes
                db.execSQL("CREATE INDEX IF NOT EXISTS index_products_barcode ON products(barcode)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_products_sku ON products(sku)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_products_category_id ON products(category_id)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_sales_created_at ON sales(created_at)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_sales_receipt_number ON sales(receipt_number)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_sync_events_status ON sync_events(status)")
            }
        }

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    DATABASE_NAME
                )
                    .addMigrations(MIGRATION_1_2)
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
