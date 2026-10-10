package com.aurapos.pos.data.dao

import androidx.room.*
import com.aurapos.pos.data.entity.*

/**
 * AuraPOS Room Data Access Objects (DAOs)
 * Conforming to Sections 7, 8, 10, 16, 17, 18, 36
 * - Atomic local sales transaction with inventory decrements & sync event creation
 * - Instant offline searches for barcode, product name, and customer
 * - Sync event queue & cursor management with idempotency checks
 */

@Dao
interface ProductDao {
    @Query("SELECT * FROM products WHERE is_active = 1 AND store_id = :storeId ORDER BY name ASC")
    suspend fun getAll(storeId: String): List<ProductEntity>

    @Query("""
        SELECT * FROM products 
        WHERE (name LIKE '%' || :query || '%' OR sku LIKE '%' || :query || '%' OR barcode LIKE '%' || :query || '%') 
          AND is_active = 1 AND store_id = :storeId 
        ORDER BY name ASC
    """)
    suspend fun search(query: String, storeId: String): List<ProductEntity>

    @Query("SELECT * FROM products WHERE barcode = :barcode AND is_active = 1 AND store_id = :storeId LIMIT 1")
    suspend fun getByBarcode(barcode: String, storeId: String): ProductEntity?

    @Query("SELECT * FROM products WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): ProductEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(product: ProductEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(products: List<ProductEntity>)

    @Update
    suspend fun update(product: ProductEntity)

    @Query("SELECT name FROM products WHERE is_active = 1 AND store_id = :storeId")
    suspend fun getAllNames(storeId: String): List<String>
}

@Dao
interface CategoryDao {
    @Query("SELECT * FROM categories WHERE is_active = 1 AND store_id = :storeId ORDER BY sort_order ASC")
    suspend fun getAll(storeId: String): List<CategoryEntity>

    @Query("SELECT * FROM categories WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): CategoryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(category: CategoryEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(categories: List<CategoryEntity>)

    @Update
    suspend fun update(category: CategoryEntity)
}

@Dao
interface CustomerDao {
    @Query("SELECT * FROM customers WHERE is_active = 1 AND store_id = :storeId ORDER BY name ASC")
    suspend fun getAll(storeId: String): List<CustomerEntity>

    @Query("""
        SELECT * FROM customers 
        WHERE (name LIKE '%' || :query || '%' OR phone LIKE '%' || :query || '%' OR email LIKE '%' || :query || '%') 
          AND is_active = 1 AND store_id = :storeId 
        ORDER BY name ASC
    """)
    suspend fun search(query: String, storeId: String): List<CustomerEntity>

    @Query("SELECT * FROM customers WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): CustomerEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(customer: CustomerEntity): Long

    @Update
    suspend fun update(customer: CustomerEntity)
}

@Dao
interface SaleDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSale(sale: SaleEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSaleItems(items: List<SaleItemEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPayments(payments: List<PaymentEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertInventoryMovement(movement: InventoryMovementEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSyncEvent(syncEvent: SyncEventEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAuditLog(auditLog: AuditLogEntity)

    @Query("SELECT * FROM inventory WHERE store_id = :storeId AND product_id = :productId LIMIT 1")
    suspend fun getInventory(storeId: String, productId: String): InventoryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertInventory(inventory: InventoryEntity)

    /**
     * ATOMIC SALES TRANSACTION (Requirement 8)
     * All operations succeed or fail together. If any fails, SQLite rolls back.
     */
    @Transaction
    suspend fun recordSaleAtomic(
        sale: SaleEntity,
        items: List<SaleItemEntity>,
        payments: List<PaymentEntity>,
        movements: List<InventoryMovementEntity>,
        syncEvent: SyncEventEntity,
        auditLog: AuditLogEntity
    ) {
        // 1. Write Sale
        insertSale(sale)

        // 2. Write SaleItems
        insertSaleItems(items)

        // 3. Write Payments
        insertPayments(payments)

        // 4. Write Inventory Movements & Update Local Inventory Projections immediately (Requirement 10)
        for (movement in movements) {
            insertInventoryMovement(movement)
            val current = getInventory(movement.storeId, movement.productId)
            val currentQty = current?.quantity ?: 0.0
            val newQty = currentQty + movement.quantity // movement.quantity is negative for sales
            upsertInventory(
                InventoryEntity(
                    id = current?.id ?: java.util.UUID.randomUUID().toString(),
                    storeId = movement.storeId,
                    productId = movement.productId,
                    quantity = newQty,
                    updatedAt = movement.createdAt
                )
            )
        }

        // 5. Create SyncEvent with idempotency key
        insertSyncEvent(syncEvent)

        // 6. Write AuditLog
        insertAuditLog(auditLog)
    }

    @Query("SELECT * FROM sales WHERE store_id = :storeId ORDER BY created_at DESC LIMIT :limit OFFSET :offset")
    suspend fun getSales(storeId: String, limit: Int = 50, offset: Int = 0): List<SaleEntity>

    @Query("SELECT * FROM sales WHERE id = :id LIMIT 1")
    suspend fun getSaleById(id: String): SaleEntity?

    @Query("SELECT * FROM sale_items WHERE sale_id = :saleId")
    suspend fun getSaleItems(saleId: String): List<SaleItemEntity>

    @Query("SELECT * FROM payments WHERE sale_id = :saleId")
    suspend fun getPayments(saleId: String): List<PaymentEntity>

    @Query("SELECT COUNT(*) FROM sales WHERE store_id = :storeId")
    suspend fun getSalesCount(storeId: String): Int

    @Query("UPDATE sales SET sync_status = :status, last_synced_at = :syncedAt WHERE id = :id")
    suspend fun updateSyncStatus(id: String, status: String, syncedAt: String)
}

@Dao
interface InventoryDao {
    @Query("SELECT * FROM inventory WHERE store_id = :storeId")
    suspend fun getAllStock(storeId: String): List<InventoryEntity>

    @Query("SELECT * FROM inventory WHERE store_id = :storeId AND product_id = :productId LIMIT 1")
    suspend fun getStock(storeId: String, productId: String): InventoryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertStock(inventory: InventoryEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun recordMovement(movement: InventoryMovementEntity)

    @Query("SELECT * FROM inventory_movements WHERE store_id = :storeId ORDER BY created_at DESC LIMIT :limit")
    suspend fun getRecentMovements(storeId: String, limit: Int = 100): List<InventoryMovementEntity>
}

@Dao
interface SyncDao {
    @Query("SELECT * FROM sync_events WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT :limit")
    suspend fun getPendingEvents(limit: Int = 50): List<SyncEventEntity>

    @Query("SELECT * FROM sync_events WHERE status = :status ORDER BY created_at DESC LIMIT :limit")
    suspend fun getEventsByStatus(status: String, limit: Int = 50): List<SyncEventEntity>

    @Query("SELECT COUNT(*) FROM sync_events WHERE status = 'PENDING'")
    suspend fun getPendingCount(): Int

    @Query("SELECT * FROM sync_events WHERE client_event_id = :clientEventId LIMIT 1")
    suspend fun getByClientEventId(clientEventId: String): SyncEventEntity?

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertEvent(event: SyncEventEntity): Long

    @Query("""
        UPDATE sync_events 
        SET status = :status, error_message = :errorMessage, processed_at = :processedAt, attempts = attempts + 1 
        WHERE id = :id
    """)
    suspend fun updateEventStatus(id: String, status: String, errorMessage: String? = null, processedAt: String? = null)

    @Query("SELECT * FROM sync_cursors WHERE terminal_id = :terminalId AND entity_type = :entityType LIMIT 1")
    suspend fun getCursor(terminalId: String, entityType: String): SyncCursorEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveCursor(cursor: SyncCursorEntity)
}

@Dao
interface CashShiftDao {
    @Query("SELECT * FROM cash_shifts WHERE store_id = :storeId AND terminal_id = :terminalId AND status = 'open' LIMIT 1")
    suspend fun getOpenShift(storeId: String, terminalId: String): CashShiftEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertShift(shift: CashShiftEntity)

    @Update
    suspend fun updateShift(shift: CashShiftEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMovement(movement: CashMovementEntity)

    @Query("SELECT * FROM cash_movements WHERE shift_id = :shiftId ORDER BY created_at ASC")
    suspend fun getMovementsForShift(shiftId: String): List<CashMovementEntity>
}

@Dao
interface PrinterDao {
    @Query("SELECT * FROM printers WHERE store_id = :storeId AND is_active = 1")
    suspend fun getAllPrinters(storeId: String): List<PrinterEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPrinter(printer: PrinterEntity)

    @Query("SELECT * FROM print_jobs WHERE status = 'PENDING' ORDER BY created_at ASC")
    suspend fun getPendingJobs(): List<PrintJobEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPrintJob(job: PrintJobEntity)

    @Update
    suspend fun updatePrintJob(job: PrintJobEntity)

    @Query("UPDATE print_jobs SET status = :status, last_error = :error, updated_at = :updatedAt WHERE id = :id")
    suspend fun updateJobStatus(id: String, status: String, error: String? = null, updatedAt: String)
}

@Dao
interface StoreSettingsDao {
    @Query("SELECT * FROM store_settings WHERE store_id = :storeId AND key = :key LIMIT 1")
    suspend fun getSetting(storeId: String, key: String): StoreSettingsEntity?

    @Query("SELECT * FROM store_settings WHERE store_id = :storeId")
    suspend fun getAllSettings(storeId: String): List<StoreSettingsEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveSetting(setting: StoreSettingsEntity)
}

@Dao
interface AuditDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(log: AuditLogEntity)

    @Query("SELECT * FROM audit_logs WHERE store_id = :storeId ORDER BY created_at DESC LIMIT :limit")
    suspend fun getRecentLogs(storeId: String, limit: Int = 100): List<AuditLogEntity>
}
