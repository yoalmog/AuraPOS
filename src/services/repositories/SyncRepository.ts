import { supabase, isSupabaseConfigured } from '../supabase/supabaseClient.ts';

export interface SyncEvent {
  id?: string;
  clientEventId: string;
  storeId: string;
  terminalId?: string;
  entityType: string;
  entityId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: any;
  status?: 'PENDING' | 'PROCESSED' | 'FAILED';
  errorMessage?: string;
  createdAt?: string;
}

export class SyncRepository {
  static async recordEvent(event: SyncEvent): Promise<void> {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from('sync_events').upsert({
          client_event_id: event.clientEventId,
          store_id: event.storeId,
          terminal_id: event.terminalId || null,
          entity_type: event.entityType,
          entity_id: event.entityId,
          operation: event.operation,
          payload: event.payload,
          status: event.status || 'PENDING'
        });
      } catch (e: any) {
        console.warn('[SyncRepository] Exception recording sync event:', e?.message);
      }
    }
  }

  static async getPendingEvents(storeId: string = 'store_aura_main'): Promise<any[]> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase
          .from('sync_events')
          .select('*')
          .eq('store_id', storeId)
          .eq('status', 'PENDING')
          .order('created_at', { ascending: true })
          .limit(50);
        return data || [];
      } catch (_) {}
    }
    return [];
  }
}
