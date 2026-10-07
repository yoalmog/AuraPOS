import { supabase, isSupabaseConfigured } from '../supabase/supabaseClient.ts';

export interface CashShiftRecord {
  id: string;
  storeId: string;
  terminalId?: string;
  userId?: string;
  openingAmount: number;
  closingAmount?: number;
  expectedAmount?: number;
  difference?: number;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
}

export interface CashMovementRecord {
  id: string;
  shiftId: string;
  type: 'cash_in' | 'cash_out' | 'drop' | 'payout';
  amount: number;
  reason?: string;
  userId?: string;
  createdAt: string;
}

export class CashShiftRepository {
  static async getCurrentShift(storeId: string = 'store_aura_main'): Promise<CashShiftRecord | null> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('cash_shifts')
          .select('*')
          .eq('store_id', storeId)
          .eq('status', 'open')
          .order('opened_at', { ascending: false })
          .limit(1)
          .single();

        if (!error && data) {
          return {
            id: data.id,
            storeId: data.store_id,
            terminalId: data.terminal_id || undefined,
            userId: data.user_id || undefined,
            openingAmount: Number(data.opening_amount),
            closingAmount: data.closing_amount ? Number(data.closing_amount) : undefined,
            expectedAmount: data.expected_amount ? Number(data.expected_amount) : undefined,
            difference: data.difference ? Number(data.difference) : undefined,
            status: data.status as 'open' | 'closed',
            openedAt: data.opened_at,
            closedAt: data.closed_at || undefined
          };
        }
      } catch (_) {}
    }
    return null;
  }

  static async openShift(shift: Omit<CashShiftRecord, 'id' | 'openedAt'>): Promise<CashShiftRecord> {
    const newShift: CashShiftRecord = {
      ...shift,
      id: crypto.randomUUID ? crypto.randomUUID() : `shift_${Date.now()}`,
      openedAt: new Date().toISOString()
    };

    if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase
          .from('cash_shifts')
          .insert({
            store_id: newShift.storeId,
            terminal_id: newShift.terminalId || null,
            user_id: newShift.userId || null,
            opening_amount: newShift.openingAmount,
            status: 'open'
          })
          .select()
          .single();

        if (data) newShift.id = data.id;
      } catch (e: any) {
        console.warn('[CashShiftRepository] Exception opening shift:', e?.message);
      }
    }

    return newShift;
  }
}
