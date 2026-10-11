import { supabase, isSupabaseConfigured } from '../supabase/supabaseClient.ts';
import { LocalDB } from '../db/localDatabase.ts';
import { StorageService } from '../storageService.ts';
import { NativeBridgeService } from '../native/NativeBridgeService.ts';
import { SyncErrorClassifier } from './SyncErrorClassifier.ts';

export type SyncConnectionState = 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'SYNCING' | 'SYNC_ERROR';

export interface SyncEngineStatus {
  state: SyncConnectionState;
  isOnline: boolean;
  lastSuccessfulSync: string | null;
  lastSyncAttempt: string | null;
  pendingUploads: number;
  pendingDownloads: number;
  failedEventsCount: number;
  currentOperation: string;
}

export interface FailedSyncEvent {
  id: string;
  clientEventId: string;
  entityType: string;
  entityId: string;
  operation: string;
  errorMessage?: string;
  attempts: number;
  createdAt: string;
}

/**
 * AuraPOS Centralized Offline-First Synchronization Engine
 * Conforming to Sections 12, 13, 14, 15, 16, 17, 18, 19, 21, 25:
 * - Single source of truth for sync orchestration across the app
 * - Bidirectional synchronization with dependency ordering
 * - Safe idempotency via client_event_id
 * - Sync checkpoints and cursors for incremental downloads
 * - Automatic execution upon network reconnect + manual Sync Now
 */
class SyncEngineClass {
  private isRunning = false;
  private isSyncing = false;
  private syncTimer: any = null;
  private lastSuccessfulSync: string | null = null;
  private lastSyncAttempt: string | null = null;
  private currentOp = 'Idle';
  private listeners = new Set<(status: SyncEngineStatus) => void>();

  constructor() {
    this.lastSuccessfulSync = localStorage.getItem('aurapos_last_sync_success');
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Listen to browser network changes
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleNetworkOnline);
      window.addEventListener('offline', this.handleNetworkOffline);
    }

    // Auto-trigger sync if online at startup
    if (this.isOnline()) {
      setTimeout(() => this.syncNow(), 1500);
    }

    // Periodic sync check every 60 seconds when online
    this.syncTimer = setInterval(() => {
      if (this.isOnline() && !this.isSyncing) {
        this.syncNow();
      }
    }, 60000);

    this.notify();
  }

  stop(): void {
    this.isRunning = false;
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleNetworkOnline);
      window.removeEventListener('offline', this.handleNetworkOffline);
    }
  }

  subscribe(listener: (status: SyncEngineStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const status = this.getStatus();
    this.listeners.forEach(fn => {
      try { fn(status); } catch (_) {}
    });
  }

  private handleNetworkOnline = (): void => {
    this.notify();
    // Requirement 21: Automatically start synchronization when internet becomes available
    this.syncNow();
  };

  private handleNetworkOffline = (): void => {
    this.notify();
  };

  isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  getStatus(): SyncEngineStatus {
    const online = this.isOnline();
    let state: SyncConnectionState = online ? 'ONLINE' : 'OFFLINE';

    if (this.isSyncing) {
      state = 'SYNCING';
    }

    return {
      state,
      isOnline: online,
      lastSuccessfulSync: this.lastSuccessfulSync,
      lastSyncAttempt: this.lastSyncAttempt,
      pendingUploads: this.getPendingCountSync(),
      pendingDownloads: 0,
      failedEventsCount: 0,
      currentOperation: this.currentOp
    };
  }

  private getPendingCountSync(): number {
    try {
      const q = StorageService.getOfflineQueue();
      return q.filter(item => item.syncStatus !== 'synced').length;
    } catch {
      return 0;
    }
  }

  async getPendingCount(): Promise<number> {
    if (NativeBridgeService.isNativeAndroid()) {
      try {
        const res = await NativeBridgeService.localDb.getPendingSyncCount();
        if (res.success) return res.pendingCount;
      } catch (_) {}
    }

    try {
      const events = await LocalDB.getAll<any>('sync_events');
      const pendingDb = events.filter(e => e.status === 'PENDING').length;
      const queue = this.getPendingCountSync();
      return Math.max(pendingDb, queue);
    } catch {
      return this.getPendingCountSync();
    }
  }

  async getFailedEvents(): Promise<FailedSyncEvent[]> {
    if (NativeBridgeService.isNativeAndroid()) {
      try {
        const res = await NativeBridgeService.localDb.getSyncEvents('FAILED', 50);
        if (res.success && Array.isArray(res.events)) {
          return res.events.map(e => ({
            id: e.id,
            clientEventId: e.clientEventId,
            entityType: e.entityType,
            entityId: e.entityId,
            operation: e.operation,
            errorMessage: e.errorMessage,
            attempts: e.attempts || 0,
            createdAt: e.createdAt
          }));
        }
      } catch (_) {}
    }

    try {
      const events = await LocalDB.getAll<any>('sync_events');
      return events
        .filter(e => e.status === 'FAILED')
        .map(e => ({
          id: e.id,
          clientEventId: e.clientEventId || e.id,
          entityType: e.entityType || 'unknown',
          entityId: e.entityId || '',
          operation: e.operation || 'INSERT',
          errorMessage: e.errorMessage || 'Synchronization error',
          attempts: e.attempts || 1,
          createdAt: e.createdAt || new Date().toISOString()
        }));
    } catch {
      return [];
    }
  }

  async retryFailed(): Promise<{ success: boolean; error?: string }> {
    if (NativeBridgeService.isNativeAndroid()) {
      try {
        await NativeBridgeService.localDb.retrySync();
      } catch (_) {}
    }

    try {
      const events = await LocalDB.getAll<any>('sync_events');
      for (const ev of events) {
        if (ev.status === 'FAILED') {
          ev.status = 'PENDING';
          ev.attempts = 0;
          await LocalDB.put('sync_events', ev);
        }
      }
    } catch (_) {}

    return this.syncNow();
  }

  /**
   * Main Bidirectional Synchronization Pipeline
   */
  async syncNow(): Promise<{ success: boolean; uploaded?: number; downloaded?: number; error?: string }> {
    if (this.isSyncing) {
      return { success: false, error: 'Synchronization already in progress' };
    }

    if (!this.isOnline()) {
      this.notify();
      return { success: false, error: 'Cannot sync while offline' };
    }

    this.isSyncing = true;
    this.lastSyncAttempt = new Date().toISOString();
    this.currentOp = 'Preparing synchronization...';
    this.notify();

    let uploadedCount = 0;
    let downloadedCount = 0;

    try {
      // 1. If running on native Android, trigger Android Room native sync engine
      if (NativeBridgeService.isNativeAndroid()) {
        try {
          this.currentOp = 'Triggering native Android sync engine...';
          await NativeBridgeService.localDb.triggerSync();
        } catch (nativeErr: any) {
          console.warn('Native Android sync trigger notice:', nativeErr?.message);
        }
      }

      // 2. If Supabase is configured, execute bidirectional sync with cloud
      if (isSupabaseConfigured && supabase) {
        const storeId = StorageService.getSettings()?.id || 'store_aura_main';

        // A. UPLOAD FLOW: Execute in foreign-key dependency order (Section 14)
        this.currentOp = 'Uploading pending offline changes...';
        this.notify();

        // Step 1: Upload offline customers
        uploadedCount += await this.uploadPendingCustomers(storeId);

        // Step 2: Upload offline sales, sale_items & payments with idempotency
        uploadedCount += await this.uploadPendingSales(storeId);

        // Step 3: Upload offline inventory movements
        uploadedCount += await this.uploadPendingInventoryMovements(storeId);

        // Step 4: Upload offline cash shifts & movements (Step 15)
        uploadedCount += await this.uploadPendingCashShifts(storeId);
        uploadedCount += await this.uploadPendingCashMovements(storeId);

        // B. DOWNLOAD FLOW: Download master data in dependency order using sync cursors (Section 15, 18)
        this.currentOp = 'Downloading master data updates...';
        this.notify();

        // Step 1: Categories & Category Translations (incremental via cursor)
        downloadedCount += await this.downloadCategories(storeId);

        // Step 2: Products & Variants & Translations (incremental via cursor)
        downloadedCount += await this.downloadProducts(storeId);

        // Step 3: Taxes (incremental via cursor)
        downloadedCount += await this.downloadTaxes(storeId);

        // Step 4: Customers (incremental via cursor)
        downloadedCount += await this.downloadCustomers(storeId);

        // Step 5: Printers (incremental via cursor)
        downloadedCount += await this.downloadPrinters(storeId);

        // Step 6: Store Settings
        downloadedCount += await this.downloadStoreSettings(storeId);

        // Step 7: User Profiles & Roles (incremental via cursor)
        downloadedCount += await this.downloadUserProfiles(storeId);
      }

      // 3. Mark successful sync
      this.lastSuccessfulSync = new Date().toISOString();
      localStorage.setItem('aurapos_last_sync_success', this.lastSuccessfulSync);
      this.currentOp = 'Idle';
      this.notify();

      return { success: true, uploaded: uploadedCount, downloaded: downloadedCount };
    } catch (err: any) {
      const classified = SyncErrorClassifier.classify(err);
      console.warn(`[SyncEngine] Synchronization cycle error [${classified.type}] (retryable=${classified.retryable}):`, classified.message);
      this.currentOp = `Sync error: ${classified.message}`;
      this.notify();
      return { success: false, error: classified.message };
    } finally {
      this.isSyncing = false;
      this.currentOp = 'Idle';
      this.notify();
    }
  }

  // -------------------------------------------------------------
  // Incremental Cursor Checkpoint Helpers (Section 4 & 5)
  // -------------------------------------------------------------

  private async getCursor(entityType: string, storeId: string): Promise<string | null> {
    try {
      const rec = await LocalDB.getById<any>('sync_cursors', `${storeId}_${entityType}`);
      return rec?.cursor || null;
    } catch {
      return null;
    }
  }

  private async saveCursor(entityType: string, storeId: string, cursor: string): Promise<void> {
    try {
      await LocalDB.put('sync_cursors', {
        id: `${storeId}_${entityType}`,
        storeId,
        entityType,
        cursor,
        updatedAt: new Date().toISOString()
      });
    } catch (_) {}
  }

  // -------------------------------------------------------------
  // Upload Helpers (Enforcing Section 3, 14 & 16 Idempotency)
  // -------------------------------------------------------------

  private async uploadPendingCustomers(storeId: string): Promise<number> {
    if (!supabase) return 0;
    let count = 0;
    try {
      const customers = await LocalDB.getAll<any>('customers');
      const pending = customers.filter(c => c.syncStatus === 'PENDING_UPLOAD' && (c.storeId === storeId || !c.storeId));

      for (const c of pending) {
        const { error } = await supabase.from('customers').upsert({
          id: c.id,
          store_id: c.storeId || storeId,
          name: c.name,
          phone: c.phone || null,
          email: c.email || null,
          address: c.address || null,
          notes: c.notes || null,
          loyalty_points: c.loyaltyPoints || 0,
          total_spent: c.totalSpent || 0,
          total_orders: c.totalOrders || 0,
          is_active: c.active !== false
        }, { onConflict: 'id' });

        if (!error) {
          c.syncStatus = 'SYNCED';
          await LocalDB.put('customers', c);
          count++;
        }
      }
    } catch (_) {}
    return count;
  }

  private async uploadPendingSales(storeId: string): Promise<number> {
    if (!supabase) return 0;
    let count = 0;

    try {
      const queue = StorageService.getOfflineQueue();
      const pendingQueue = queue.filter(item => item.syncStatus !== 'synced');

      for (const item of pendingQueue) {
        const sale = item.sale;
        try {
          // Attempt atomic server RPC sync_process_sale first (Step 13)
          let uploaded = false;
          try {
            const { data: rpcData, error: rpcErr } = await supabase.rpc('sync_process_sale', {
              p_sale: {
                id: sale.id && sale.id.length === 36 ? sale.id : undefined,
                store_id: sale.storeId || storeId,
                receipt_number: sale.receiptNumber,
                customer_id: sale.customerId && sale.customerId.length === 36 ? sale.customerId : null,
                cashier_id: null,
                subtotal: sale.subtotal,
                discount_total: sale.discountAmount || 0,
                tax_total: sale.taxAmount || 0,
                total: sale.total,
                currency: '$',
                status: 'completed',
                is_offline: true,
                client_created_at: sale.createdAt
              },
              p_items: (sale.items || []).map(it => ({
                id: it.id && it.id.length === 36 ? it.id : undefined,
                product_id: it.productId && it.productId.length === 36 ? it.productId : null,
                product_name_snapshot: it.productName || 'Item',
                quantity: it.quantity,
                unit_price: it.unitPrice,
                discount: it.discountAmount || 0,
                tax: it.taxAmount || 0,
                total: it.lineTotal,
                created_at: sale.createdAt
              })),
              p_payments: (sale.payments || []).map(p => ({
                id: p.id && p.id.length === 36 ? p.id : undefined,
                method: p.method || 'cash',
                amount: p.amount,
                tendered: p.tendered || null,
                change: p.change || null,
                status: 'completed',
                provider_reference: p.transactionReference || null,
                created_at: p.createdAt || sale.createdAt
              })),
              p_movements: [],
              p_client_event_id: `sale_event_${sale.id}`
            });

            if (!rpcErr && rpcData?.success) {
              uploaded = true;
              item.syncStatus = 'synced';
              count++;
            }
          } catch (_) {
            // Fall back to table upserts if RPC not present in environment
          }

          if (!uploaded) {
            // Idempotent upsert of sale using immutable sale UUID (Section 3)
            const { error: saleErr } = await supabase.from('sales').upsert({
              id: sale.id.length === 36 ? sale.id : undefined,
              store_id: sale.storeId || storeId,
              receipt_number: sale.receiptNumber,
              customer_id: sale.customerId && sale.customerId.length === 36 ? sale.customerId : null,
              cashier_id: null,
              subtotal: sale.subtotal,
              discount_total: sale.discountAmount || 0,
              tax_total: sale.taxAmount || 0,
              total: sale.total,
              currency: '$',
              status: 'completed',
              is_offline: true,
              client_created_at: sale.createdAt
            }, { onConflict: 'id' });

            if (!saleErr) {
              // Upsert line items idempotently with immutable UUID
              if (Array.isArray(sale.items) && sale.items.length > 0) {
                const itemRows = sale.items.map(it => ({
                  id: it.id && it.id.length === 36 ? it.id : undefined,
                  sale_id: sale.id,
                  product_id: it.productId && it.productId.length === 36 ? it.productId : null,
                  product_name_snapshot: it.productName || 'Item',
                  quantity: it.quantity,
                  unit_price: it.unitPrice,
                  discount: it.discountAmount || 0,
                  tax: it.taxAmount || 0,
                  total: it.lineTotal,
                  created_at: sale.createdAt
                }));
                await supabase.from('sale_items').upsert(itemRows, { onConflict: 'id' });
              }

              // Upsert payments idempotently with immutable UUID
              if (Array.isArray(sale.payments) && sale.payments.length > 0) {
                const paymentRows = sale.payments.map(p => ({
                  id: p.id && p.id.length === 36 ? p.id : undefined,
                  sale_id: sale.id,
                  method: p.method || 'cash',
                  amount: p.amount,
                  tendered: p.tendered || null,
                  change: p.change || null,
                  status: 'completed',
                  provider_reference: p.transactionReference || null,
                  created_at: p.createdAt || sale.createdAt
                }));
                await supabase.from('payments').upsert(paymentRows, { onConflict: 'id' });
              }

              item.syncStatus = 'synced';
              count++;
            }
          }
        } catch (_) {}
      }

      StorageService.saveOfflineQueue(queue.filter(item => item.syncStatus !== 'synced'));
    } catch (_) {}

    return count;
  }

  private async uploadPendingInventoryMovements(storeId: string): Promise<number> {
    if (!supabase) return 0;
    let count = 0;
    try {
      const movements = await LocalDB.getAll<any>('inventory_movements');
      const pending = movements.filter(m => m.syncStatus === 'PENDING_UPLOAD' && (m.storeId === storeId || !m.storeId));

      for (const m of pending) {
        const { error } = await supabase.from('inventory_movements').upsert({
          id: m.id.length === 36 ? m.id : undefined,
          store_id: m.storeId || storeId,
          product_id: m.productId,
          type: m.type || 'sale',
          quantity: m.quantity,
          reference_type: m.referenceType || 'SALE',
          reference_id: m.referenceId,
          created_at: m.createdAt
        }, { onConflict: 'id' });

        if (!error) {
          m.syncStatus = 'SYNCED';
          await LocalDB.put('inventory_movements', m);
          count++;
        }
      }
    } catch (_) {}
    return count;
  }

  private async uploadPendingCashShifts(storeId: string): Promise<number> {
    if (!supabase) return 0;
    let count = 0;
    try {
      const shifts = await LocalDB.getAll<any>('cash_shifts');
      const pending = shifts.filter(s => s.syncStatus === 'PENDING_UPLOAD' && (s.storeId === storeId || !s.storeId));

      for (const s of pending) {
        const { error } = await supabase.from('cash_shifts').upsert({
          id: s.id && s.id.length === 36 ? s.id : undefined,
          store_id: s.storeId || storeId,
          terminal_id: s.terminalId && s.terminalId.length === 36 ? s.terminalId : null,
          user_id: s.userId && s.userId.length === 36 ? s.userId : null,
          opening_amount: s.openingAmount,
          closing_amount: s.closingAmount !== undefined ? s.closingAmount : null,
          expected_amount: s.expectedAmount !== undefined ? s.expectedAmount : null,
          difference: s.difference !== undefined ? s.difference : null,
          status: s.status || 'open',
          opened_at: s.openedAt,
          closed_at: s.closedAt || null
        }, { onConflict: 'id' });

        if (!error) {
          s.syncStatus = 'SYNCED';
          await LocalDB.put('cash_shifts', s);
          count++;
        }
      }
    } catch (_) {}
    return count;
  }

  private async uploadPendingCashMovements(storeId: string): Promise<number> {
    if (!supabase) return 0;
    let count = 0;
    try {
      const moves = await LocalDB.getAll<any>('cash_movements');
      const pending = moves.filter(m => m.syncStatus === 'PENDING_UPLOAD');

      for (const m of pending) {
        const { error } = await supabase.from('cash_movements').upsert({
          id: m.id && m.id.length === 36 ? m.id : undefined,
          shift_id: m.shiftId,
          type: m.type,
          amount: m.amount,
          reason: m.reason || null,
          user_id: m.userId && m.userId.length === 36 ? m.userId : null,
          created_at: m.createdAt
        }, { onConflict: 'id' });

        if (!error) {
          m.syncStatus = 'SYNCED';
          await LocalDB.put('cash_movements', m);
          count++;
        }
      }
    } catch (_) {}
    return count;
  }

  // -------------------------------------------------------------
  // Incremental Download Helpers (Sections 4, 5, 15, 18)
  // -------------------------------------------------------------

  private async downloadCategories(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
      const cursor = await this.getCursor('categories', storeId);
      let query = supabase
        .from('categories')
        .select('*')
        .eq('store_id', storeId)
        .order('updated_at', { ascending: true });

      if (cursor) {
        query = query.gt('updated_at', cursor);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const cat of data) {
          const isDeleted = Boolean(cat.deleted_at || cat.is_active === false);
          await LocalDB.put('categories', {
            id: cat.id,
            storeId: cat.store_id,
            name: cat.name || cat.icon,
            iconName: cat.icon || 'Package',
            color: cat.color || '#2563EB',
            sortOrder: cat.sort_order || 0,
            active: !isDeleted,
            isDeleted,
            syncStatus: 'SYNCED',
            updatedAt: cat.updated_at
          });
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('categories', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadProducts(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
      const cursor = await this.getCursor('products', storeId);
      let query = supabase
        .from('products')
        .select('*')
        .eq('store_id', storeId)
        .order('updated_at', { ascending: true });

      if (cursor) {
        query = query.gt('updated_at', cursor);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const p of data) {
          const isDeleted = Boolean(p.deleted_at || p.is_active === false);
          await LocalDB.put('products', {
            id: p.id,
            storeId: p.store_id,
            categoryId: p.category_id || '',
            name: p.name,
            sku: p.sku || '',
            barcode: p.barcode || '',
            description: p.description || '',
            price: Number(p.price),
            cost: Number(p.cost || 0),
            unit: p.unit || 'item',
            trackInventory: p.track_inventory,
            stock: Number(p.stock_minimum || 50),
            lowStockThreshold: Number(p.stock_minimum || 10),
            active: !isDeleted,
            isDeleted,
            isFavorite: p.is_favorite,
            imageUrl: p.image_url,
            syncStatus: 'SYNCED',
            createdAt: p.created_at,
            updatedAt: p.updated_at
          });
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('products', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadTaxes(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
      const cursor = await this.getCursor('taxes', storeId);
      let query = supabase.from('taxes').select('*').eq('store_id', storeId).order('updated_at', { ascending: true });
      if (cursor) query = query.gt('updated_at', cursor);
      const { data, error } = await query;
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const t of data) {
          await LocalDB.put('taxes', t);
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('taxes', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadCustomers(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
      const cursor = await this.getCursor('customers', storeId);
      let query = supabase.from('customers').select('*').eq('store_id', storeId).order('updated_at', { ascending: true });
      if (cursor) query = query.gt('updated_at', cursor);
      const { data, error } = await query;
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const c of data) {
          await LocalDB.put('customers', {
            id: c.id,
            storeId: c.store_id,
            name: c.name,
            phone: c.phone || '',
            email: c.email || '',
            address: c.address || '',
            notes: c.notes || '',
            loyaltyPoints: c.loyalty_points || 0,
            totalSpent: Number(c.total_spent || 0),
            totalOrders: c.total_orders || 0,
            active: c.is_active,
            syncStatus: 'SYNCED',
            createdAt: c.created_at,
            updatedAt: c.updated_at
          });
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('customers', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadPrinters(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
      const cursor = await this.getCursor('printers', storeId);
      let query = supabase.from('printers').select('*').eq('store_id', storeId).order('updated_at', { ascending: true });
      if (cursor) query = query.gt('updated_at', cursor);
      const { data, error } = await query;
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const pr of data) {
          await LocalDB.put('printers', pr);
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('printers', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadStoreSettings(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
      const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).maybeSingle();
      if (!error && data) {
        await LocalDB.put('stores', data);
        return 1;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadUserProfiles(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
      const cursor = await this.getCursor('user_profiles', storeId);
      let query = supabase.from('user_profiles').select('*').eq('store_id', storeId).order('updated_at', { ascending: true });
      if (cursor) query = query.gt('updated_at', cursor);
      const { data, error } = await query;
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const u of data) {
          await LocalDB.put('user_profiles', u);
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('user_profiles', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }
}

export const SyncEngine = new SyncEngineClass();
// Auto-start SyncEngine in browser / WebView runtime
if (typeof window !== 'undefined') {
  SyncEngine.start();
}
