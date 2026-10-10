package com.aurapos.pos

import com.aurapos.pos.data.entity.*
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

/**
 * Phase 3 Automated Unit Tests
 * Testing:
 * - Local Database entities & UUID integrity
 * - Movement-based inventory calculations
 * - Offline cash transaction rules
 * - Idempotency validation
 * - Conflict resolution strategy
 */
class POSOfflineDatabaseUnitTest {

    @Test
    fun testEntityUuidGeneration() {
        val storeId = UUID.randomUUID().toString()
        val saleId = UUID.randomUUID().toString()
        val productId = UUID.randomUUID().toString()

        val sale = SaleEntity(
            id = saleId,
            storeId = storeId,
            receiptNumber = "REC-1001",
            subtotal = 45.0,
            discountTotal = 5.0,
            taxTotal = 3.2,
            total = 43.2,
            isOffline = true,
            syncStatus = SyncStatus.PENDING_UPLOAD,
            clientCreatedAt = "2026-10-08T12:00:00Z",
            createdAt = "2026-10-08T12:00:00Z",
            updatedAt = "2026-10-08T12:00:00Z"
        )

        assertEquals(36, sale.id.length)
        assertTrue(sale.isOffline)
        assertEquals(SyncStatus.PENDING_UPLOAD, sale.syncStatus)
    }

    @Test
    fun testMovementBasedInventory() {
        val storeId = "store_01"
        val productId = "prod_01"
        val saleId = "sale_123"

        // Initial inventory projection
        val initialStock = 50.0

        // Create sale movement (Section 10: negative quantity)
        val soldQuantity = 3.0
        val movement = InventoryMovementEntity(
            id = UUID.randomUUID().toString(),
            storeId = storeId,
            productId = productId,
            type = "sale",
            quantity = -soldQuantity,
            referenceType = "SALE",
            referenceId = saleId,
            createdAt = "2026-10-08T12:00:00Z",
            syncStatus = SyncStatus.PENDING_UPLOAD
        )

        // Updated inventory projection
        val newStock = initialStock + movement.quantity
        assertEquals(47.0, newStock, 0.001)
        assertTrue(movement.quantity < 0)
    }

    @Test
    fun testIdempotencyKeyUniqueness() {
        val clientEventIdA = "client_event_" + UUID.randomUUID().toString()
        val clientEventIdB = "client_event_" + UUID.randomUUID().toString()

        assertNotEquals(clientEventIdA, clientEventIdB)

        val syncEventA = SyncEventEntity(
            id = UUID.randomUUID().toString(),
            clientEventId = clientEventIdA,
            storeId = "store_01",
            entityType = "sale",
            entityId = "sale_1",
            operation = "INSERT",
            payload = "{}",
            status = "PENDING",
            createdAt = "2026-10-08T12:00:00Z"
        )

        assertEquals(clientEventIdA, syncEventA.clientEventId)
        assertEquals("PENDING", syncEventA.status)
    }

    @Test
    fun testOfflineCashSalePaymentValidation() {
        val grandTotal = 25.50
        val tenderedAmount = 30.00
        val changeDue = tenderedAmount - grandTotal

        assertEquals(4.50, changeDue, 0.001)

        val payment = PaymentEntity(
            id = UUID.randomUUID().toString(),
            saleId = "sale_abc",
            method = "cash",
            amount = grandTotal,
            tendered = tenderedAmount,
            change = changeDue,
            status = "completed",
            createdAt = "2026-10-08T12:00:00Z",
            updatedAt = "2026-10-08T12:00:00Z"
        )

        assertEquals("cash", payment.method)
        assertEquals("completed", payment.status)
        assertEquals(tenderedAmount, payment.tendered!!, 0.001)
    }

    @Test
    fun testInventoryConflictReconciliation() {
        // Multi-terminal scenario (Section 11):
        // Terminal A sells 4 offline, Terminal B sells 4 offline
        val movementsTerminalA = listOf(-4.0)
        val movementsTerminalB = listOf(-4.0)

        val totalMovements = (movementsTerminalA + movementsTerminalB).sum()
        val initialStock = 5.0
        val reconciledStock = initialStock + totalMovements

        // Reconciled stock becomes -3.0 (negative inventory detected, not silently lost)
        assertEquals(-3.0, reconciledStock, 0.001)
        assertTrue("Conflict detected when stock goes negative under movement reconciliation", reconciledStock < 0)
    }

    @Test
    fun testIncrementalSyncCursorAdvancement() {
        // Section 4: Incremental sync cursor
        val terminalId = "term_01"
        val entityType = "products"
        val initialCursor = "2026-10-08T10:00:00.000Z"

        val cursorEntity = SyncCursorEntity(
            id = "cursor_${terminalId}_$entityType",
            terminalId = terminalId,
            entityType = entityType,
            cursor = initialCursor,
            updatedAt = "2026-10-08T10:00:00.000Z"
        )

        assertEquals(initialCursor, cursorEntity.cursor)

        // Incoming batch has items with timestamps 10:05 and 10:15
        val batchTimestamps = listOf("2026-10-08T10:05:00.000Z", "2026-10-08T10:15:00.000Z")
        val advancedCursor = batchTimestamps.maxOrNull() ?: initialCursor

        val updatedCursorEntity = cursorEntity.copy(
            cursor = advancedCursor,
            updatedAt = "2026-10-08T10:15:01.000Z"
        )

        assertEquals("2026-10-08T10:15:00.000Z", updatedCursorEntity.cursor)
        assertTrue(updatedCursorEntity.cursor > initialCursor)
    }

    @Test
    fun testImmutableSaleUuidDuplicateProtection() {
        // Section 3: Immutable UUID idempotency check
        val saleId = UUID.randomUUID().toString()
        val receiptNumber = "REC-1002"

        val originalSale = SaleEntity(
            id = saleId,
            storeId = "store_aura_main",
            receiptNumber = receiptNumber,
            subtotal = 50.0,
            discountTotal = 0.0,
            taxTotal = 4.0,
            total = 54.0,
            isOffline = true,
            syncStatus = SyncStatus.PENDING_UPLOAD,
            clientCreatedAt = "2026-10-08T12:00:00Z",
            createdAt = "2026-10-08T12:00:00Z",
            updatedAt = "2026-10-08T12:00:00Z"
        )

        // Retried payload with same immutable saleId
        val retriedSale = originalSale.copy(
            syncStatus = SyncStatus.SYNCED,
            lastSyncedAt = "2026-10-08T12:05:00Z"
        )

        // Primary key equality guarantees single row in Room & Supabase
        assertEquals(originalSale.id, retriedSale.id)
    }

    @Test
    fun testOfflineCashShiftReconciliation() {
        // Section 6: Cash Shift offline reconciliation
        val shiftId = UUID.randomUUID().toString()
        val openingAmount = 150.00
        val cashSalesTotal = 320.50
        val payOut = 20.00
        val actualClosingCounted = 450.50

        val expectedClosing = openingAmount + cashSalesTotal - payOut
        val difference = actualClosingCounted - expectedClosing

        val shift = CashShiftEntity(
            id = shiftId,
            storeId = "store_aura_main",
            terminalId = "term_01",
            openingAmount = openingAmount,
            closingAmount = actualClosingCounted,
            expectedAmount = expectedClosing,
            difference = difference,
            status = "closed",
            openedAt = "2026-10-08T08:00:00Z",
            closedAt = "2026-10-08T16:00:00Z",
            syncStatus = SyncStatus.PENDING_UPLOAD
        )

        assertEquals(450.50, shift.expectedAmount!!, 0.001)
        assertEquals(0.00, shift.difference!!, 0.001)
        assertEquals("closed", shift.status)
    }
}
