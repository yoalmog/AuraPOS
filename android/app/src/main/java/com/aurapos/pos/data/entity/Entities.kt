package com.aurapos.pos.data.entity

import androidx.room.*

/**
 * AuraPOS Local Room Database Entities
 * Conforming to Phase 3 Specifications (Sections 4, 5, 6, 17, 18, 36):
 * - Canonical PostgreSQL / Supabase cloud model compatibility
 * - UUID-based primary keys generated locally
 * - Sync metadata: sync_status, created_at, updated_at, last_synced_at
 * - Performance indexes for barcode, SKU, category, sales, inventory, and sync queues
 */

object SyncStatus {
    const val LOCAL_ONLY = "LOCAL_ONLY"
    const val PENDING_UPLOAD = "PENDING_UPLOAD"
    const val SYNCED = "SYNCED"
    const val PENDING_UPDATE = "PENDING_UPDATE"
    const val PENDING_DELETE = "PENDING_DELETE"
    const val CONFLICT = "CONFLICT"
    const val SYNC_ERROR = "SYNC_ERROR"
}

// -----------------------------------------------------------------------------
// 1. STORES & TERMINALS
// -----------------------------------------------------------------------------

@Entity(tableName = "stores")
data class StoreEntity(
    @PrimaryKey val id: String,
    val name: String,
    @ColumnInfo(name = "legal_name") val legalName: String? = null,
    val address: String = "{}",
    val phone: String? = null,
    val email: String? = null,
    val currency: String = "$",
    val timezone: String = "UTC",
    @ColumnInfo(name = "default_locale") val defaultLocale: String = "en",
    @ColumnInfo(name = "tax_number") val taxNumber: String? = null,
    @ColumnInfo(name = "logo_url") val logoUrl: String? = null,
    @ColumnInfo(name = "is_active") val isActive: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

@Entity(
    tableName = "terminals",
    indices = [
        Index(value = ["store_id"]),
        Index(value = ["store_id", "device_identifier"], unique = true)
    ]
)
data class TerminalEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    val name: String,
    @ColumnInfo(name = "device_identifier") val deviceIdentifier: String,
    val status: String = "active", // active, inactive, maintenance
    @ColumnInfo(name = "last_seen_at") val lastSeenAt: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

// -----------------------------------------------------------------------------
// 2. ROLES, PERMISSIONS & USERS
// -----------------------------------------------------------------------------

@Entity(tableName = "roles")
data class RoleEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String
)

@Entity(tableName = "permissions")
data class PermissionEntity(
    @PrimaryKey val id: String,
    val code: String,
    val module: String,
    val description: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String
)

@Entity(
    tableName = "role_permissions",
    primaryKeys = ["role_id", "permission_id"]
)
data class RolePermissionEntity(
    @ColumnInfo(name = "role_id") val roleId: String,
    @ColumnInfo(name = "permission_id") val permissionId: String
)

@Entity(
    tableName = "user_profiles",
    indices = [Index(value = ["store_id"])]
)
data class UserProfileEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "display_name") val displayName: String,
    val phone: String? = null,
    @ColumnInfo(name = "pin_hash") val pinHash: String? = null,
    @ColumnInfo(name = "is_active") val isActive: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

// -----------------------------------------------------------------------------
// 3. CATEGORIES & TRANSLATIONS
// -----------------------------------------------------------------------------

@Entity(
    tableName = "categories",
    indices = [
        Index(value = ["store_id"]),
        Index(value = ["sort_order"]),
        Index(value = ["is_active"]),
        Index(value = ["updated_at"])
    ]
)
data class CategoryEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "default_locale") val defaultLocale: String = "en",
    val name: String,
    val icon: String = "Utensils",
    @ColumnInfo(name = "image_url") val imageUrl: String? = null,
    val color: String = "#2563EB",
    @ColumnInfo(name = "sort_order") val sortOrder: Int = 0,
    @ColumnInfo(name = "parent_id") val parentId: String? = null,
    @ColumnInfo(name = "printer_id") val printerId: String? = null,
    @ColumnInfo(name = "auto_print_kitchen") val autoPrintKitchen: Boolean = true,
    @ColumnInfo(name = "is_active") val isActive: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    @ColumnInfo(name = "sync_status") val syncStatus: String = SyncStatus.SYNCED,
    @ColumnInfo(name = "last_synced_at") val lastSyncedAt: String? = null
)

@Entity(
    tableName = "category_translations",
    indices = [
        Index(value = ["category_id"]),
        Index(value = ["category_id", "locale"], unique = true)
    ]
)
data class CategoryTranslationEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "category_id") val categoryId: String,
    val locale: String,
    val name: String,
    val description: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

// -----------------------------------------------------------------------------
// 4. TAXES
// -----------------------------------------------------------------------------

@Entity(
    tableName = "taxes",
    indices = [Index(value = ["store_id"])]
)
data class TaxEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    val name: String,
    val rate: Double,
    val inclusive: Boolean = false,
    @ColumnInfo(name = "is_active") val isActive: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

// -----------------------------------------------------------------------------
// 5. PRODUCTS, VARIANTS & TRANSLATIONS
// -----------------------------------------------------------------------------

@Entity(
    tableName = "products",
    indices = [
        Index(value = ["barcode"]),
        Index(value = ["sku"]),
        Index(value = ["category_id"]),
        Index(value = ["store_id"]),
        Index(value = ["is_active"]),
        Index(value = ["updated_at"])
    ]
)
data class ProductEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "category_id") val categoryId: String? = null,
    @ColumnInfo(name = "tax_id") val taxId: String? = null,
    val name: String,
    val sku: String? = null,
    val barcode: String? = null,
    val description: String? = null,
    val price: Double,
    val cost: Double = 0.0,
    val unit: String = "item",
    @ColumnInfo(name = "track_inventory") val trackInventory: Boolean = true,
    @ColumnInfo(name = "stock_minimum") val stockMinimum: Double = 0.0,
    @ColumnInfo(name = "is_favorite") val isFavorite: Boolean = false,
    @ColumnInfo(name = "is_active") val isActive: Boolean = true,
    @ColumnInfo(name = "image_url") val imageUrl: String? = null,
    @ColumnInfo(name = "image_metadata") val imageMetadata: String = "{}",
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    @ColumnInfo(name = "sync_status") val syncStatus: String = SyncStatus.SYNCED,
    @ColumnInfo(name = "last_synced_at") val lastSyncedAt: String? = null
)

@Entity(
    tableName = "product_translations",
    indices = [
        Index(value = ["product_id"]),
        Index(value = ["product_id", "locale"], unique = true)
    ]
)
data class ProductTranslationEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "product_id") val productId: String,
    val locale: String,
    val name: String,
    val description: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

@Entity(
    tableName = "product_variants",
    indices = [Index(value = ["product_id"])]
)
data class ProductVariantEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "product_id") val productId: String,
    val name: String,
    val sku: String? = null,
    val barcode: String? = null,
    val price: Double,
    val cost: Double = 0.0,
    val attributes: String = "{}",
    @ColumnInfo(name = "is_active") val isActive: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

// -----------------------------------------------------------------------------
// 6. CUSTOMERS
// -----------------------------------------------------------------------------

@Entity(
    tableName = "customers",
    indices = [
        Index(value = ["store_id"]),
        Index(value = ["phone"]),
        Index(value = ["email"]),
        Index(value = ["updated_at"])
    ]
)
data class CustomerEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    val name: String,
    val phone: String? = null,
    val email: String? = null,
    val address: String? = null,
    val notes: String? = null,
    @ColumnInfo(name = "loyalty_points") val loyaltyPoints: Int = 0,
    @ColumnInfo(name = "lifetime_points") val lifetimePoints: Int = 0,
    @ColumnInfo(name = "total_spent") val totalSpent: Double = 0.0,
    @ColumnInfo(name = "total_orders") val totalOrders: Int = 0,
    @ColumnInfo(name = "is_active") val isActive: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    @ColumnInfo(name = "sync_status") val syncStatus: String = SyncStatus.SYNCED,
    @ColumnInfo(name = "last_synced_at") val lastSyncedAt: String? = null
)

// -----------------------------------------------------------------------------
// 7. SALES, SALE ITEMS & PAYMENTS
// -----------------------------------------------------------------------------

@Entity(
    tableName = "sales",
    indices = [
        Index(value = ["store_id"]),
        Index(value = ["created_at"]),
        Index(value = ["terminal_id"]),
        Index(value = ["status"]),
        Index(value = ["sync_status"]),
        Index(value = ["receipt_number"])
    ]
)
data class SaleEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "terminal_id") val terminalId: String? = null,
    @ColumnInfo(name = "cashier_id") val cashierId: String? = null,
    @ColumnInfo(name = "customer_id") val customerId: String? = null,
    @ColumnInfo(name = "receipt_number") val receiptNumber: String,
    @ColumnInfo(name = "order_type") val orderType: String = "dine_in",
    val status: String = "completed", // completed, refunded, partially_refunded, cancelled
    val subtotal: Double,
    @ColumnInfo(name = "discount_total") val discountTotal: Double = 0.0,
    @ColumnInfo(name = "tax_total") val taxTotal: Double = 0.0,
    val total: Double,
    val currency: String = "$",
    @ColumnInfo(name = "is_offline") val isOffline: Boolean = false,
    @ColumnInfo(name = "sync_status") val syncStatus: String = SyncStatus.PENDING_UPLOAD,
    @ColumnInfo(name = "client_created_at") val clientCreatedAt: String,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    @ColumnInfo(name = "last_synced_at") val lastSyncedAt: String? = null
)

@Entity(
    tableName = "sale_items",
    indices = [
        Index(value = ["sale_id"]),
        Index(value = ["product_id"])
    ]
)
data class SaleItemEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "sale_id") val saleId: String,
    @ColumnInfo(name = "product_id") val productId: String? = null,
    @ColumnInfo(name = "variant_id") val variantId: String? = null,
    @ColumnInfo(name = "product_name_snapshot") val productNameSnapshot: String,
    @ColumnInfo(name = "sku_snapshot") val skuSnapshot: String? = null,
    val quantity: Double,
    @ColumnInfo(name = "unit_price") val unitPrice: Double,
    val discount: Double = 0.0,
    val tax: Double = 0.0,
    val total: Double,
    @ColumnInfo(name = "created_at") val createdAt: String
)

@Entity(
    tableName = "payments",
    indices = [
        Index(value = ["sale_id"])
    ]
)
data class PaymentEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "sale_id") val saleId: String,
    val method: String, // cash, card, mobile, bank, loyalty, etc.
    val amount: Double,
    val tendered: Double? = null,
    val change: Double? = null,
    val status: String = "completed",
    @ColumnInfo(name = "provider_reference") val providerReference: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

@Entity(
    tableName = "refunds",
    indices = [Index(value = ["sale_id"])]
)
data class RefundEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "sale_id") val saleId: String,
    @ColumnInfo(name = "user_id") val userId: String? = null,
    val amount: Double,
    val reason: String? = null,
    val status: String = "completed",
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

// -----------------------------------------------------------------------------
// 8. INVENTORY & INVENTORY MOVEMENTS (Movement-based Ledger)
// -----------------------------------------------------------------------------

@Entity(
    tableName = "inventory",
    indices = [
        Index(value = ["product_id"]),
        Index(value = ["store_id"]),
        Index(value = ["store_id", "product_id"], unique = true)
    ]
)
data class InventoryEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "product_id") val productId: String,
    val quantity: Double = 0.0,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

@Entity(
    tableName = "inventory_movements",
    indices = [
        Index(value = ["store_id"]),
        Index(value = ["product_id"]),
        Index(value = ["type"]),
        Index(value = ["reference_id"]),
        Index(value = ["created_at"])
    ]
)
data class InventoryMovementEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "product_id") val productId: String,
    val type: String, // sale, refund, adjustment, purchase, transfer, damaged, count
    val quantity: Double, // negative for sales
    @ColumnInfo(name = "reference_type") val referenceType: String? = null,
    @ColumnInfo(name = "reference_id") val referenceId: String? = null,
    @ColumnInfo(name = "user_id") val userId: String? = null,
    @ColumnInfo(name = "terminal_id") val terminalId: String? = null,
    val notes: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "sync_status") val syncStatus: String = SyncStatus.PENDING_UPLOAD
)

// -----------------------------------------------------------------------------
// 9. CASH SHIFTS & CASH MOVEMENTS
// -----------------------------------------------------------------------------

@Entity(
    tableName = "cash_shifts",
    indices = [Index(value = ["store_id"]), Index(value = ["terminal_id"])]
)
data class CashShiftEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "terminal_id") val terminalId: String? = null,
    @ColumnInfo(name = "user_id") val userId: String? = null,
    @ColumnInfo(name = "opening_amount") val openingAmount: Double = 0.0,
    @ColumnInfo(name = "closing_amount") val closingAmount: Double? = null,
    @ColumnInfo(name = "expected_amount") val expectedAmount: Double? = null,
    val difference: Double? = null,
    val status: String = "open", // open, closed
    @ColumnInfo(name = "opened_at") val openedAt: String,
    @ColumnInfo(name = "closed_at") val closedAt: String? = null,
    @ColumnInfo(name = "sync_status") val syncStatus: String = SyncStatus.PENDING_UPLOAD
)

@Entity(
    tableName = "cash_movements",
    indices = [Index(value = ["shift_id"])]
)
data class CashMovementEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "shift_id") val shiftId: String,
    val type: String, // cash_in, cash_out, drop, payout
    val amount: Double,
    val reason: String? = null,
    @ColumnInfo(name = "user_id") val userId: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "sync_status") val syncStatus: String = SyncStatus.PENDING_UPLOAD
)

// -----------------------------------------------------------------------------
// 10. PRINTERS & PRINT JOBS
// -----------------------------------------------------------------------------

@Entity(tableName = "printers")
data class PrinterEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "terminal_id") val terminalId: String? = null,
    val name: String,
    @ColumnInfo(name = "connection_type") val connectionType: String, // BLUETOOTH, USB, NETWORK, BUILTIN, BROWSER
    @ColumnInfo(name = "device_identifier") val deviceIdentifier: String? = null,
    val address: String? = null,
    val port: Int = 9100,
    val protocol: String = "ESC_POS",
    @ColumnInfo(name = "paper_width") val paperWidth: Int = 58,
    val capabilities: String = "[]",
    @ColumnInfo(name = "is_default") val isDefault: Boolean = false,
    @ColumnInfo(name = "is_active") val isActive: Boolean = true,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    @ColumnInfo(name = "last_seen_at") val lastSeenAt: String? = null
)

@Entity(
    tableName = "print_jobs",
    indices = [
        Index(value = ["status"]),
        Index(value = ["created_at"]),
        Index(value = ["printer_id"]),
        Index(value = ["terminal_id"])
    ]
)
data class PrintJobEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "terminal_id") val terminalId: String? = null,
    @ColumnInfo(name = "printer_id") val printerId: String,
    @ColumnInfo(name = "sale_id") val saleId: String? = null,
    @ColumnInfo(name = "job_type") val jobType: String,
    val payload: String,
    val status: String = "PENDING", // PENDING, PRINTING, PRINTED, FAILED, CANCELLED
    @ColumnInfo(name = "attempt_count") val attemptCount: Int = 0,
    @ColumnInfo(name = "last_error") val lastError: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    @ColumnInfo(name = "printed_at") val printedAt: String? = null
)

// -----------------------------------------------------------------------------
// 11. IDEMPOTENT OFFLINE SYNC TABLES (Sections 16, 17, 18)
// -----------------------------------------------------------------------------

@Entity(
    tableName = "sync_events",
    indices = [
        Index(value = ["status"]),
        Index(value = ["created_at"]),
        Index(value = ["client_event_id"], unique = true)
    ]
)
data class SyncEventEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "client_event_id") val clientEventId: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "terminal_id") val terminalId: String? = null,
    @ColumnInfo(name = "entity_type") val entityType: String,
    @ColumnInfo(name = "entity_id") val entityId: String,
    val operation: String, // INSERT, UPDATE, DELETE
    val payload: String, // JSON payload (never contains passwords, PINs, or secrets)
    val status: String = "PENDING", // PENDING, PROCESSED, FAILED
    @ColumnInfo(name = "attempts") val attempts: Int = 0,
    @ColumnInfo(name = "error_message") val errorMessage: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "processed_at") val processedAt: String? = null
)

@Entity(
    tableName = "sync_cursors",
    indices = [
        Index(value = ["terminal_id", "entity_type"], unique = true)
    ]
)
data class SyncCursorEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "terminal_id") val terminalId: String,
    @ColumnInfo(name = "entity_type") val entityType: String,
    val cursor: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String
)

// -----------------------------------------------------------------------------
// 12. AUDIT LOGS & SETTINGS
// -----------------------------------------------------------------------------

@Entity(
    tableName = "audit_logs",
    indices = [
        Index(value = ["store_id"]),
        Index(value = ["created_at"])
    ]
)
data class AuditLogEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "user_id") val userId: String? = null,
    @ColumnInfo(name = "terminal_id") val terminalId: String? = null,
    val action: String,
    @ColumnInfo(name = "entity_type") val entityType: String,
    @ColumnInfo(name = "entity_id") val entityId: String,
    val metadata: String = "{}",
    @ColumnInfo(name = "created_at") val createdAt: String
)

@Entity(
    tableName = "store_settings",
    indices = [
        Index(value = ["store_id", "key"], unique = true)
    ]
)
data class StoreSettingsEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    val key: String,
    val value: String, // JSON string
    @ColumnInfo(name = "updated_at") val updatedAt: String
)
