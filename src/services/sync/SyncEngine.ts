import React, { useState, useEffect } from 'react';
import { usePOS } from '../../../context/POSContext.tsx';
import { SyncEngine, FailedSyncEvent } from '../../../services/sync/SyncEngine.ts';
import { NativeBridgeService } from '../../../services/native/NativeBridgeService.ts';
import {
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowUpCircle,
  ArrowDownCircle,
  ShieldCheck,
  RotateCcw,
  Terminal,
  Database,
  Info
} from 'lucide-react';

export const SyncCenterTab: React.FC = () => {
  const {
    isOffline,
    isSyncing,
    pendingSyncCount,
    triggerSync,
    retryFailedSync,
    syncEngineStatus,
    settings,
    isOwner,
    t
  } = usePOS();

  const [failedEvents, setFailedEvents] = useState<FailedSyncEvent[]>([]);
  const [terminalInfo, setTerminalInfo] = useState<any>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState<boolean>(false);

  useEffect(() => {
    loadSyncData();
  }, [syncEngineStatus, isSyncing]);

  const loadSyncData = async () => {
    setIsLoadingEvents(true);
    try {
      const failed = await SyncEngine.getFailedEvents();
      setFailedEvents(failed);

      if (NativeBridgeService.isNativeAndroid()) {
        const idInfo = NativeBridgeService.localDb.getTerminalIdentity();
        setTerminalInfo(idInfo);
      }
    } catch (_) {
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const handleManualSync = () => {
    triggerSync();
  };

  const handleRetryFailed = async () => {
    await retryFailedSync();
    await loadSyncData();
  };

  const formatTimestamp = (iso: string | null) => {
    if (!iso) return t('sync.never', 'Never');
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-[var(--theme-surface-variant)] border border-[var(--theme-border)]">
        <div className="flex items-center gap-3.5">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              isSyncing
                ? 'bg-blue-500/10 text-blue-600'
                : syncEngineStatus?.state === 'SYNC_ERROR'
                ? 'bg-rose-500/10 text-rose-600'
                : isOffline
                ? 'bg-amber-500/10 text-amber-600'
                : 'bg-emerald-500/10 text-emerald-600'
            }`}
          >
            {isSyncing ? (
              <RefreshCw className="w-6 h-6 animate-spin" />
            ) : syncEngineStatus?.state === 'SYNC_ERROR' ? (
              <AlertTriangle className="w-6 h-6" />
            ) : isOffline ? (
              <WifiOff className="w-6 h-6" />
            ) : (
              <Wifi className="w-6 h-6" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-[var(--theme-text-primary)]">
                {t('sync.centerTitle', 'Offline-First Synchronization Engine')}
              </h3>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  isSyncing
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                    : syncEngineStatus?.state === 'SYNC_ERROR'
                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                    : isOffline
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                }`}
              >
                {syncEngineStatus?.state || (isOffline ? 'OFFLINE' : 'ONLINE')}
              </span>
            </div>
            <p className="text-xs text-[var(--theme-text-secondary)] mt-0.5">
              {isOffline
                ? t('sync.offlineNotice', 'Operating offline. Local database is active and recording all transactions.')
                : t('sync.onlineNotice', 'Connected. Automatic bidirectional sync active between local terminal & cloud.')}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          {failedEvents.length > 0 && (
            <button
              onClick={handleRetryFailed}
              disabled={isSyncing}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t('sync.retryFailed', 'Retry Failed')} ({failedEvents.length})</span>
            </button>
          )}

          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-[var(--theme-primary)] hover:opacity-90 text-white shadow-xs transition-opacity cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? t('sync.syncingBtn', 'Syncing...') : t('sync.syncNowBtn', 'Sync Now')}</span>
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Pending Uploads */}
        <div className="p-4 rounded-xl theme-surface border border-[var(--theme-border)]">
          <div className="flex items-center justify-between text-[var(--theme-text-secondary)]">
            <span className="text-xs font-medium">{t('sync.pendingUploads', 'Pending Uploads')}</span>
            <ArrowUpCircle className="w-4 h-4 text-sky-500" />
          </div>
          <p className="text-2xl font-bold text-[var(--theme-text-primary)] mt-1.5 font-mono">
            {pendingSyncCount}
          </p>
          <span className="text-[10px] text-[var(--theme-text-secondary)] mt-1 block">
            {pendingSyncCount === 0 ? t('sync.allSaved', 'All transactions uploaded') : t('sync.queuedToUpload', 'Queued for cloud synchronization')}
          </span>
        </div>

        {/* Pending Downloads */}
        <div className="p-4 rounded-xl theme-surface border border-[var(--theme-border)]">
          <div className="flex items-center justify-between text-[var(--theme-text-secondary)]">
            <span className="text-xs font-medium">{t('sync.pendingDownloads', 'Pending Downloads')}</span>
            <ArrowDownCircle className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-[var(--theme-text-primary)] mt-1.5 font-mono">
            {syncEngineStatus?.pendingDownloads || 0}
          </p>
          <span className="text-[10px] text-[var(--theme-text-secondary)] mt-1 block">
            {t('sync.masterDataSync', 'Master catalog & settings')}
          </span>
        </div>

        {/* Last Successful Sync */}
        <div className="p-4 rounded-xl theme-surface border border-[var(--theme-border)]">
          <div className="flex items-center justify-between text-[var(--theme-text-secondary)]">
            <span className="text-xs font-medium">{t('sync.lastSuccess', 'Last Success')}</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-xs font-bold text-[var(--theme-text-primary)] mt-2 font-mono truncate">
            {formatTimestamp(syncEngineStatus?.lastSuccessfulSync || null)}
          </p>
          <span className="text-[10px] text-[var(--theme-text-secondary)] mt-1 block">
            {t('sync.verifiedSync', 'Verified cloud confirmation')}
          </span>
        </div>

        {/* Last Attempt */}
        <div className="p-4 rounded-xl theme-surface border border-[var(--theme-border)]">
          <div className="flex items-center justify-between text-[var(--theme-text-secondary)]">
            <span className="text-xs font-medium">{t('sync.lastAttempt', 'Last Attempt')}</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-xs font-bold text-[var(--theme-text-primary)] mt-2 font-mono truncate">
            {formatTimestamp(syncEngineStatus?.lastSyncAttempt || null)}
          </p>
          <span className="text-[10px] text-[var(--theme-text-secondary)] mt-1 block">
            {syncEngineStatus?.currentOperation || 'Idle'}
          </span>
        </div>
      </div>

      {/* Terminal Identification & Isolation (Sections 26 & 27) */}
      <div className="p-4 rounded-2xl theme-surface border border-[var(--theme-border)] space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--theme-text-secondary)]">
          <Terminal className="w-4 h-4" />
          <span>{t('sync.terminalIdentity', 'Terminal Identification & Isolation (Keystore Protected)')}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
          <div className="p-3 rounded-xl bg-[var(--theme-surface-variant)] border border-[var(--theme-border)]">
            <span className="text-[10px] text-[var(--theme-text-secondary)] uppercase block font-sans font-bold">
              {t('sync.storeId', 'Store ID')}
            </span>
            <span className="font-bold text-[var(--theme-text-primary)] truncate block mt-0.5">
              {terminalInfo?.storeId || settings.id || 'store_aura_main'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[var(--theme-surface-variant)] border border-[var(--theme-border)]">
            <span className="text-[10px] text-[var(--theme-text-secondary)] uppercase block font-sans font-bold">
              {t('sync.terminalId', 'Persistent Terminal ID')}
            </span>
            <span className="font-bold text-[var(--theme-text-primary)] truncate block mt-0.5">
              {terminalInfo?.terminalId || 'term_aura_pos_01'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[var(--theme-surface-variant)] border border-[var(--theme-border)]">
            <span className="text-[10px] text-[var(--theme-text-secondary)] uppercase block font-sans font-bold">
              {t('sync.databaseEngine', 'Local Database Engine')}
            </span>
            <span className="font-bold text-emerald-600 truncate block mt-0.5">
              {NativeBridgeService.isNativeAndroid() ? 'Android Room + SQLite (v2)' : 'IndexedDB (Offline Engine v4)'}
            </span>
          </div>
        </div>
      </div>

      {/* Failed Sync Events (For Administrators - Section 33) */}
      <div className="p-4 rounded-2xl theme-surface border border-[var(--theme-border)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h4 className="text-sm font-bold text-[var(--theme-text-primary)]">
              {t('sync.failedEventsTitle', 'Failed Sync Events (Administrator Inspection)')}
            </h4>
          </div>
          <span className="text-xs text-[var(--theme-text-secondary)]">
            {failedEvents.length} {t('sync.issuesReported', 'issue(s)')}
          </span>
        </div>

        {failedEvents.length === 0 ? (
          <div className="p-6 text-center rounded-xl bg-[var(--theme-surface-variant)] border border-[var(--theme-border)]">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-xs font-bold text-[var(--theme-text-primary)]">
              {t('sync.noFailedEvents', 'Zero Failed Synchronization Events')}
            </p>
            <p className="text-[11px] text-[var(--theme-text-secondary)] mt-0.5">
              {t('sync.cleanPipeline', 'All transactional and catalog events are processed or queued safely.')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[var(--theme-text-secondary)]">
              <thead className="bg-[var(--theme-surface-variant)] border-b border-[var(--theme-border)] text-[var(--theme-text-primary)] font-bold uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Client Event ID</th>
                  <th className="py-2.5 px-3">Entity Type</th>
                  <th className="py-2.5 px-3">Operation</th>
                  <th className="py-2.5 px-3">Attempts</th>
                  <th className="py-2.5 px-3">Error Cause</th>
                  <th className="py-2.5 px-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--theme-border)]">
                {failedEvents.map(ev => (
                  <tr key={ev.id} className="hover:bg-[var(--theme-surface-variant)] transition-colors">
                    <td className="py-2 px-3 font-mono text-[11px] text-[var(--theme-text-primary)]">
                      {ev.clientEventId}
                    </td>
                    <td className="py-2 px-3 uppercase text-[10px] font-bold">
                      {ev.entityType}
                    </td>
                    <td className="py-2 px-3 uppercase font-semibold">
                      {ev.operation}
                    </td>
                    <td className="py-2 px-3 font-mono">
                      {ev.attempts}
                    </td>
                    <td className="py-2 px-3 text-rose-600 max-w-xs truncate">
                      {ev.errorMessage || 'Server unreachable'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-[11px]">
                      {new Date(ev.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
