package com.aurapos.pos.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

/**
 * AuraPOS Native Android Persistent Local Database
 * Conforming to Section 15: "Use a real persistent Android-compatible local database.
 * The database must persist across: app restart, device restart, Android process restart."
 */
class LocalDatabaseHelper(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        // 1. Products Table
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                category_id TEXT,
                name TEXT NOT NULL,
                sku TEXT,
                barcode TEXT,
                price REAL NOT NULL,
                cost REAL DEFAULT 0,
                unit TEXT DEFAULT 'item',
                track_inventory INTEGER DEFAULT 1,
                stock REAL DEFAULT 0,
                low_stock_threshold REAL DEFAULT 0,
                color TEXT,
                is_favorite INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        // 2. Categories Table
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                name TEXT NOT NULL,
                icon_name TEXT,
                color TEXT,
                sort_order INTEGER DEFAULT 0,
                printer_id TEXT,
                active INTEGER DEFAULT 1
            );
        """.trimIndent())

        // 3. Sales Table
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS sales (
                id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                receipt_number TEXT NOT NULL,
                customer_id TEXT,
                cashier_id TEXT,
                subtotal REAL NOT NULL,
                discount_amount REAL DEFAULT 0,
                tax_amount REAL DEFAULT 0,
                grand_total REAL NOT NULL,
                payment_status TEXT NOT NULL,
                sync_status TEXT DEFAULT 'PENDING',
                created_at TEXT NOT NULL,
                synced_at TEXT
            );
        """.trimIndent())

        // 4. Sale Items Table
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS sale_items (
                id TEXT PRIMARY KEY,
                sale_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                product_name TEXT NOT NULL,
                unit_price REAL NOT NULL,
                quantity REAL NOT NULL,
                line_total REAL NOT NULL,
                FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
            );
        """.trimIndent())

        // 5. Customers Table
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS customers (
                id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                phone TEXT,
                email TEXT,
                loyalty_points INTEGER DEFAULT 0,
                total_spent REAL DEFAULT 0,
                total_orders INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );
        """.trimIndent())

        // 6. Payments Table
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS payments (
                id TEXT PRIMARY KEY,
                sale_id TEXT NOT NULL,
                method TEXT NOT NULL,
                amount REAL NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
            );
        """.trimIndent())

        // 7. Printers Table (Physical hardware registry)
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS printers (
                id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                name TEXT NOT NULL,
                model TEXT NOT NULL,
                printer_type TEXT NOT NULL,
                connection_type TEXT NOT NULL,
                ip_address TEXT,
                port INTEGER DEFAULT 9100,
                device_identifier TEXT,
                paper_width INTEGER DEFAULT 58,
                characters_per_line INTEGER DEFAULT 32,
                encoding TEXT DEFAULT 'CP437',
                is_default INTEGER DEFAULT 0,
                printer_purpose TEXT DEFAULT 'receipt',
                auto_print INTEGER DEFAULT 1,
                supports_cut INTEGER DEFAULT 0,
                supports_cash_drawer INTEGER DEFAULT 0,
                status TEXT DEFAULT 'OFFLINE',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        // 8. Print Jobs Table (Section 11: Persistent Local Print Queue)
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS print_jobs (
                id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                printer_id TEXT NOT NULL,
                document_type TEXT NOT NULL,
                reference_id TEXT,
                payload TEXT NOT NULL,
                status TEXT NOT NULL, -- PENDING, PRINTING, COMPLETED, FAILED, CANCELLED
                attempts INTEGER DEFAULT 0,
                error TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT
            );
        """.trimIndent())

        // 9. Settings Table
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        // 10. Sync Queue Table (Section 16: Offline Synchronization Engine)
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS sync_queue (
                id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                status TEXT DEFAULT 'PENDING',
                created_at TEXT NOT NULL
            );
        """.trimIndent())
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Handle migrations gracefully without dropping sales or pending print jobs
    }

    // Print Queue DAO methods
    fun enqueuePrintJob(
        id: String,
        storeId: String,
        printerId: String,
        documentType: String,
        referenceId: String?,
        payload: String,
        status: String = "PENDING"
    ): Long {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("id", id)
            put("store_id", storeId)
            put("printer_id", printerId)
            put("document_type", documentType)
            put("reference_id", referenceId)
            put("payload", payload)
            put("status", status)
            put("attempts", 0)
            put("created_at", System.currentTimeMillis().toString())
        }
        return db.insertWithOnConflict("print_jobs", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun updatePrintJobStatus(id: String, status: String, error: String? = null) {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("status", status)
            if (error != null) put("error", error)
            if (status == "COMPLETED") put("completed_at", System.currentTimeMillis().toString())
            if (status == "PRINTING") put("started_at", System.currentTimeMillis().toString())
        }
        db.update("print_jobs", values, "id = ?", arrayOf(id))
    }

    companion object {
        const val DATABASE_NAME = "aurapos_pos.db"
        const val DATABASE_VERSION = 1
    }
}
