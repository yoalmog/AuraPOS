package com.aurapos.pos.data

import android.content.Context
import com.aurapos.pos.data.entity.*
import com.aurapos.pos.device.DeviceIdentityManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

/**
 * AuraPOS Local Repository Layer
 * Conforming to Section 1 & Section 7 (Offline-First Rule):
 * - The Local Database is the FIRST write target for all POS operations
 * - Atomic local sales transaction with UUIDs, inventory movements, sync event, audit log
 * - Fast local product & barcode lookup without network requests
 */
class LocalRepository(private val context: Context) {

    private val db = AppDatabase.getInstance(context)
    private val identityManager = DeviceIdentityManager(context)

    private fun getIsoNow(): String {
        return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())
    }

    suspend fun getProducts(query: String? = null, storeId: String? = null): List<ProductEntity> = withContext(Dispatchers.IO) {
        val effectiveStoreId = storeId ?: identityManager.getStoreId()
        if (query.isNullOrBlank()) {
            db.productDao().getAll(effectiveStoreId)
        } else {
            db.productDao().search(query.trim(), effectiveStoreId)
        }
    }

    suspend fun getProductByBarcode(barcode: String, storeId: String? = null): ProductEntity? = withContext(Dispatchers.IO) {
        val effectiveStoreId = storeId ?: identityManager.getStoreId()
        db.productDao().getByBarcode(barcode.trim(), effectiveStoreId)
    }

    suspend fun getCategories(storeId: String? = null): List<CategoryEntity> = withContext(Dispatchers.IO) {
        val effectiveStoreId = storeId ?: identityManager.getStoreId()
        db.categoryDao().getAll(effectiveStoreId)
    }

    suspend fun getCustomers(query: String? = null, storeId: String? = null): List<CustomerEntity> = withContext(Dispatchers.IO) {
        val effectiveStoreId = storeId ?: identityManager.getStoreId()
        if (query.isNullOrBlank()) {
            db.customerDao().getAll(effectiveStoreId)
        } else {
            db.customerDao().search(query.trim(), effectiveStoreId)
        }
    }

    suspend fun saveCustomer(customerJson: JSONObject, storeId: String? = null): CustomerEntity = withContext(Dispatchers.IO) {
        val effectiveStoreId = storeId ?: identityManager.getStoreId()
        val now = getIsoNow()
        val id = customerJson.optString("id").ifBlank { UUID.randomUUID().toString() }
        val customer = CustomerEntity(
            id = id,
            storeId = effectiveStoreId,
            name = customerJson.optString("name", "Unnamed Customer"),
            phone = customerJson.optString("phone").ifBlank { null },
            email = customerJson.optString("email").ifBlank { null },
            address = customerJson.optString("address").ifBlank { null },
            notes = customerJson.optString("notes").ifBlank { null },
            loyaltyPoints = customerJson.optInt("loyaltyPoints", 0),
            lifetimePoints = customerJson.optInt("lifetimePoints", 0),
            totalSpent = customerJson.optDouble("totalSpent", 0.0),
            totalOrders = customerJson.optInt("totalOrders", 0),
            isActive = customerJson.optBoolean("active", true),
            createdAt = customerJson.optString("createdAt", now),
            updatedAt = now,
            syncStatus = SyncStatus.PENDING_UPLOAD
        )
        db.customerDao().insert(customer)

        // Generate sync event
        val syncEvent = SyncEventEntity(
            id = UUID.randomUUID().toString(),
            clientEventId = UUID.randomUUID().toString(),
            storeId = effectiveStoreId,
            terminalId = identityManager.getTerminalId(),
            entityType = "customer",
            entityId = id,
            operation = "INSERT",
            payload = customerJson.toString(),
            status = "PENDING",
            createdAt = now
        )
        db.syncDao().insertEvent(syncEvent)

        customer
    }

    /**
     * ATOMIC OFFLINE SALES TRANSACTION (Requirements 7, 8, 9, 10, 16)
     */
    suspend fun recordSaleAtomic(saleJson: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val effectiveStoreId = saleJson.optString("storeId").ifBlank { identityManager.getStoreId() }
        val terminalId = identityManager.getTerminalId()
        val now = getIsoNow()

        // 1. Generate local UUIDs consistently
        val saleId = saleJson.optString("id").ifBlank { UUID.randomUUID().toString() }
        val receiptNumber = saleJson.optString("receiptNumber", "REC-${System.currentTimeMillis() % 100000}")

        val saleEntity = SaleEntity(
            id = saleId,
            storeId = effectiveStoreId,
            terminalId = terminalId,
            cashierId = saleJson.optString("employeeId").ifBlank { null },
            customerId = saleJson.optString("customerId").ifBlank { null },
            receiptNumber = receiptNumber,
            orderType = saleJson.optString("orderType", "dine_in"),
            status = "completed",
            subtotal = saleJson.optDouble("subtotal", 0.0),
            discountTotal = saleJson.optDouble("discountAmount", 0.0),
            taxTotal = saleJson.optDouble("taxAmount", 0.0),
            total = saleJson.optDouble("total", 0.0),
            currency = saleJson.optString("currency", "$"),
            isOffline = true,
            syncStatus = SyncStatus.PENDING_UPLOAD,
            clientCreatedAt = saleJson.optString("createdAt", now),
            createdAt = now,
            updatedAt = now
        )

        // 2. Parse Items
        val itemsArray = saleJson.optJSONArray("items") ?: JSONArray()
        val saleItems = mutableListOf<SaleItemEntity>()
        val inventoryMovements = mutableListOf<InventoryMovementEntity>()

        for (i in 0 until itemsArray.length()) {
            val itemObj = itemsArray.getJSONObject(i)
            val itemId = itemObj.optString("id").ifBlank { UUID.randomUUID().toString() }
            val prodId = itemObj.optString("productId").ifBlank { null }
            val qty = itemObj.optDouble("quantity", 1.0)
            val unitPrice = itemObj.optDouble("unitPrice", 0.0)
            val lineTotal = itemObj.optDouble("lineTotal", qty * unitPrice)

            saleItems.add(
                SaleItemEntity(
                    id = itemId,
                    saleId = saleId,
                    productId = prodId,
                    variantId = itemObj.optString("variantId").ifBlank { null },
                    productNameSnapshot = itemObj.optString("productName", "Item"),
                    skuSnapshot = itemObj.optString("sku").ifBlank { null },
                    quantity = qty,
                    unitPrice = unitPrice,
                    discount = itemObj.optDouble("discountAmount", 0.0),
                    tax = itemObj.optDouble("taxAmount", 0.0),
                    total = lineTotal,
                    createdAt = now
                )
            )

            // Requirement 10: Inventory Movement (type = sale, quantity = negative)
            if (!prodId.isNullOrBlank()) {
                inventoryMovements.add(
                    InventoryMovementEntity(
                        id = UUID.randomUUID().toString(),
                        storeId = effectiveStoreId,
                        productId = prodId,
                        type = "sale",
                        quantity = -Math.abs(qty),
                        referenceType = "SALE",
                        referenceId = saleId,
                        userId = saleEntity.cashierId,
                        terminalId = terminalId,
                        notes = "Offline sale $receiptNumber",
                        createdAt = now,
                        syncStatus = SyncStatus.PENDING_UPLOAD
                    )
                )
            }
        }

        // 3. Parse Payments
        val paymentsArray = saleJson.optJSONArray("payments") ?: JSONArray()
        val payments = mutableListOf<PaymentEntity>()
        for (i in 0 until paymentsArray.length()) {
            val pObj = paymentsArray.getJSONObject(i)
            payments.add(
                PaymentEntity(
                    id = pObj.optString("id").ifBlank { UUID.randomUUID().toString() },
                    saleId = saleId,
                    method = pObj.optString("method", "cash"),
                    amount = pObj.optDouble("amount", saleEntity.total),
                    tendered = if (pObj.has("tendered")) pObj.optDouble("tendered") else null,
                    change = if (pObj.has("change")) pObj.optDouble("change") else null,
                    status = "completed",
                    providerReference = pObj.optString("transactionReference").ifBlank { null },
                    createdAt = now,
                    updatedAt = now
                )
            )
        }

        // 4. Create Idempotent Sync Event
        val syncEvent = SyncEventEntity(
            id = UUID.randomUUID().toString(),
            clientEventId = UUID.randomUUID().toString(),
            storeId = effectiveStoreId,
            terminalId = terminalId,
            entityType = "sale",
            entityId = saleId,
            operation = "INSERT",
            payload = saleJson.toString(),
            status = "PENDING",
            createdAt = now
        )

        // 5. Create Audit Log
        val auditLog = AuditLogEntity(
            id = UUID.randomUUID().toString(),
            storeId = effectiveStoreId,
            userId = saleEntity.cashierId,
            terminalId = terminalId,
            action = "SALE_COMPLETED_OFFLINE",
            entityType = "sale",
            entityId = saleId,
            metadata = JSONObject().apply {
                put("receiptNumber", receiptNumber)
                put("total", saleEntity.total)
                put("itemsCount", saleItems.size)
            }.toString(),
            createdAt = now
        )

        // 6. Execute Atomic Transaction in Room
        db.saleDao().recordSaleAtomic(
            sale = saleEntity,
            items = saleItems,
            payments = payments,
            movements = inventoryMovements,
            syncEvent = syncEvent,
            auditLog = auditLog
        )

        JSONObject().apply {
            put("success", true)
            put("saleId", saleId)
            put("receiptNumber", receiptNumber)
            put("syncStatus", SyncStatus.PENDING_UPLOAD)
        }
    }

    suspend fun getSales(limit: Int = 50, offset: Int = 0, storeId: String? = null): List<SaleEntity> = withContext(Dispatchers.IO) {
        val effectiveStoreId = storeId ?: identityManager.getStoreId()
        db.saleDao().getSales(effectiveStoreId, limit, offset)
    }

    suspend fun getPendingSyncCount(): Int = withContext(Dispatchers.IO) {
        db.syncDao().getPendingCount()
    }

    suspend fun getSyncEvents(status: String = "PENDING", limit: Int = 50): List<SyncEventEntity> = withContext(Dispatchers.IO) {
        if (status == "PENDING") {
            db.syncDao().getPendingEvents(limit)
        } else {
            db.syncDao().getEventsByStatus(status, limit)
        }
    }

    suspend fun getLocalReports(dateFrom: String, dateTo: String, storeId: String? = null): JSONObject = withContext(Dispatchers.IO) {
        val effectiveStoreId = storeId ?: identityManager.getStoreId()
        val sales = db.saleDao().getSales(effectiveStoreId, 1000, 0)
        var totalSalesAmount = 0.0
        var totalTransactions = 0
        var cashTotal = 0.0
        var cardTotal = 0.0

        for (s in sales) {
            if (s.createdAt in dateFrom..dateTo || dateFrom.isBlank()) {
                totalSalesAmount += s.total
                totalTransactions++
                val payments = db.saleDao().getPayments(s.id)
                for (p in payments) {
                    if (p.method.equals("cash", ignoreCase = true)) {
                        cashTotal += p.amount
                    } else {
                        cardTotal += p.amount
                    }
                }
            }
        }

        JSONObject().apply {
            put("source", "LOCAL_DATA")
            put("totalSales", totalSalesAmount)
            put("transactionCount", totalTransactions)
            put("cashTotal", cashTotal)
            put("cardTotal", cardTotal)
            put("isOfflineSnapshot", true)
        }
    }
}
