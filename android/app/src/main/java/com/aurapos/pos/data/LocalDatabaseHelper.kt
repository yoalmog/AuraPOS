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

    // -------------------------------------------------------------
    // Menu Scanner Persistent SQLite DAO (Requirement 15)
    // -------------------------------------------------------------

    fun getAllProductNames(): List<String> {
        val names = mutableListOf<String>()
        val db = readableDatabase
        val cursor = db.rawQuery("SELECT name FROM products WHERE active = 1", null)
        cursor.use {
            while (it.moveToNext()) {
                val n = it.getString(0)
                if (!n.isNullOrBlank()) names.add(n)
            }
        }
        return names
    }

    fun batchImportMenu(
        categoriesArray: org.json.JSONArray,
        productsArray: org.json.JSONArray,
        storeId: String = "store_aura_main"
    ): JSONObject {
        val db = writableDatabase
        db.beginTransaction()
        var importedCategories = 0
        var importedProducts = 0
        var updatedProducts = 0

        try {
            val now = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply {
                timeZone = java.util.TimeZone.getTimeZone("UTC")
            }.format(java.util.Date())

            val categoryIdMap = mutableMapOf<String, String>()

            for (i in 0 until categoriesArray.length()) {
                val cat = categoriesArray.getJSONObject(i)
                val catName = cat.optString("name", "General").trim()
                val catId = cat.optString("id", "cat_${System.currentTimeMillis()}_$i")
                val icon = cat.optString("iconName", "Package")
                val color = cat.optString("color", "#2563EB")
                val sortOrder = cat.optInt("sortOrder", i + 1)

                categoryIdMap[catName.lowercase()] = catId
                categoryIdMap[cat.optString("tempId")] = catId

                val values = ContentValues().apply {
                    put("id", catId)
                    put("store_id", storeId)
                    put("name", catName)
                    put("icon_name", icon)
                    put("color", color)
                    put("sort_order", sortOrder)
                    put("active", 1)
                }
                db.insertWithOnConflict("categories", null, values, SQLiteDatabase.CONFLICT_REPLACE)
                importedCategories++
            }

            for (i in 0 until productsArray.length()) {
                val prod = productsArray.getJSONObject(i)
                val prodName = prod.optString("name", "").trim()
                if (prodName.isEmpty()) continue

                val prodId = prod.optString("id", "prod_${System.currentTimeMillis()}_$i")
                val catName = prod.optString("categoryName", "General").trim()
                val catId = categoryIdMap[catName.lowercase()] ?: categoryIdMap[prod.optString("categoryId")] ?: "cat_general"
                val price = prod.optDouble("price", 0.0)
                val cost = prod.optDouble("cost", price * 0.35)
                val sku = prod.optString("sku", "SKU-${System.currentTimeMillis() % 10000}")
                val barcode = prod.optString("barcode", "")
                val unit = prod.optString("unit", "item")
                val resolution = prod.optString("resolution", "create_new")

                val values = ContentValues().apply {
                    put("id", prodId)
                    put("store_id", storeId)
                    put("category_id", catId)
                    put("name", prodName)
                    put("sku", sku)
                    put("barcode", barcode)
                    put("price", price)
                    put("cost", cost)
                    put("unit", unit)
                    put("track_inventory", 1)
                    put("stock", 50.0)
                    put("low_stock_threshold", 10.0)
                    put("active", 1)
                    put("updated_at", now)
                    if (resolution == "create_new") {
                        put("created_at", now)
                    }
                }

                val rowId = db.insertWithOnConflict("products", null, values, SQLiteDatabase.CONFLICT_REPLACE)
                if (resolution == "update_existing") {
                    updatedProducts++
                } else {
                    importedProducts++
                }
            }

            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }

        return JSONObject().apply {
            put("success", true)
            put("importedCategories", importedCategories)
            put("importedProducts", importedProducts)
            put("updatedProducts", updatedProducts)
        }
    }

    companion object {
        const val DATABASE_NAME = "aurapos_pos.db"
        const val DATABASE_VERSION = 1
    }
}
