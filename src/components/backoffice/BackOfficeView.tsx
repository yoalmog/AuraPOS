import React, { useState, useEffect, useMemo } from 'react';
import { usePOS } from '../../context/POSContext.tsx';
import { BackOfficeService } from '../../services/backOfficeService.ts';
import {
  StoreLocation,
  TerminalDevice,
  MultiStoreOverview,
  GlobalInventoryItem,
  StaffMemberManagement,
  CashShiftSummary
} from '../../types/backOffice.ts';
import {
  Building2,
  Store,
  TrendingUp,
  BarChart3,
  Layers,
  Users,
  CreditCard,
  Download,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  Filter,
  ShieldCheck,
  Terminal,
  DollarSign,
  MapPin,
  ChevronDown,
  ArrowUpRight,
  Sparkles
} from 'lucide-react';

export const BackOfficeView: React.FC = () => {
  const {
    formatCurrency,
    formatDate,
    showToast,
    isOwner,
    currentEmployee,
    availableStores,
    currentStoreId,
    switchStore,
    triggerSync,
    isSyncing,
    t
  } = usePOS();

  // Navigation Tabs
  type BackOfficeTab = 'overview' | 'inventory' | 'staff' | 'shifts' | 'locations';
  const [activeTab, setActiveTab] = useState<BackOfficeTab>('overview');

  // Filters
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | '7days' | '30days' | 'all'>('7days');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Data State
  const [loading, setLoading] = useState<boolean>(true);
  const [overview, setOverview] = useState<MultiStoreOverview | null>(null);
  const [globalInventory, setGlobalInventory] = useState<GlobalInventoryItem[]>([]);
  const [staffList, setStaffList] = useState<StaffMemberManagement[]>([]);
  const [cashShifts, setCashShifts] = useState<CashShiftSummary[]>([]);
  const [terminals, setTerminals] = useState<TerminalDevice[]>([]);

  // Load back office data
  const loadData = async () => {
    setLoading(true);
    try {
      const [ov, inv, stf, shf, trm] = await Promise.all([
        BackOfficeService.getMultiStoreOverview(dateRange, selectedStoreFilter),
        BackOfficeService.getGlobalInventory(),
        BackOfficeService.getStaffMembers(),
        BackOfficeService.getCashShifts(selectedStoreFilter),
        BackOfficeService.getTerminals()
      ]);
      setOverview(ov);
      setGlobalInventory(inv);
      setStaffList(stf);
      setCashShifts(shf);
      setTerminals(trm);
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Error loading back office data',
        message: err?.message || 'Could not fetch cloud data'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [dateRange, selectedStoreFilter]);

  // CSV Export
  const handleExportCsv = () => {
    if (!overview) return;
    try {
      BackOfficeService.downloadReportCsv(
        overview,
        `aurapos_hq_report_${dateRange}_${new Date().toISOString().substring(0, 10)}.csv`
      );
      showToast({
        type: 'success',
        title: 'Report Exported',
        message: 'CSV file downloaded successfully.'
      });
    } catch (e: any) {
      showToast({
        type: 'error',
        title: 'Export Failed',
        message: e?.message || 'Could not export CSV'
      });
    }
  };

  // Filtered inventory
  const filteredInventory = useMemo(() => {
    if (!searchQuery) return globalInventory;
    const q = searchQuery.toLowerCase();
    return globalInventory.filter(
      item =>
        item.productName.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.barcode.includes(q) ||
        item.categoryName.toLowerCase().includes(q)
    );
  }, [globalInventory, searchQuery]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--theme-surface)] overflow-y-auto">
      {/* Top HQ Header Bar */}
      <div className="p-4 sm:p-6 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] sticky top-0 z-20 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-[var(--theme-text-primary)]">
                  Cloud Back Office HQ
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 uppercase tracking-wider">
                  Enterprise Multi-Store
                </span>
              </div>
              <p className="text-xs text-[var(--theme-text-secondary)] mt-0.5">
                Centralized administration, multi-store consolidated revenue, global inventory & staff RBAC
              </p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Store Location Filter */}
            <div className="flex items-center bg-[var(--theme-surface-variant)] border border-[var(--theme-border)] rounded-xl px-3 py-1.5 text-xs font-semibold">
              <Store className="w-3.5 h-3.5 mr-2 text-[var(--theme-text-secondary)]" />
              <select
                aria-label="Filter by store location"
                value={selectedStoreFilter}
                onChange={e => setSelectedStoreFilter(e.target.value)}
                className="bg-transparent border-none text-[var(--theme-text-primary)] focus:outline-hidden cursor-pointer"
              >
                <option value="all">All Stores (Consolidated)</option>
                {availableStores.map(st => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range Selector */}
            <div className="flex items-center bg-[var(--theme-surface-variant)] border border-[var(--theme-border)] rounded-xl px-3 py-1.5 text-xs font-semibold">
              <Clock className="w-3.5 h-3.5 mr-2 text-[var(--theme-text-secondary)]" />
              <select
                aria-label="Filter by date range"
                value={dateRange}
                onChange={e => setDateRange(e.target.value as any)}
                className="bg-transparent border-none text-[var(--theme-text-primary)] focus:outline-hidden cursor-pointer"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
                <option value="all">All Time</option>
              </select>
            </div>

            {/* CSV Export Button */}
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] hover:bg-[var(--theme-surface-variant)] text-xs font-bold text-[var(--theme-text-primary)] transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-blue-600" />
              <span>Export CSV</span>
            </button>

            {/* Sync Cloud Trigger */}
            <button
              onClick={() => {
                triggerSync();
                loadData();
              }}
              disabled={isSyncing}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Cloud'}</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation Navigation Bar */}
        <div className="flex items-center gap-2 border-b border-[var(--theme-border)] pt-2 overflow-x-auto">
          {[
            { id: 'overview', label: 'Consolidated Analytics', icon: BarChart3 },
            { id: 'inventory', label: 'Global Inventory', icon: Layers, badge: globalInventory.filter(i => i.isLowStock).length || undefined },
            { id: 'staff', label: 'Staff & Roles (RBAC)', icon: Users },
            { id: 'shifts', label: 'Cash Shift Audits', icon: DollarSign },
            { id: 'locations', label: 'Store Locations', icon: Store }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as BackOfficeTab)}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-white font-mono">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="p-4 sm:p-6 space-y-6">
        {/* TAB 1: CONSOLIDATED ANALYTICS OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Executive KPI Metric Ribbon */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl theme-surface border border-[var(--theme-border)] shadow-xs">
                <div className="flex items-center justify-between text-[var(--theme-text-secondary)]">
                  <span className="text-xs font-semibold">Consolidated Gross Sales</span>
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                    <DollarSign className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-2xl sm:text-3xl font-black text-[var(--theme-text-primary)] mt-2 font-mono">
                  {formatCurrency(overview?.consolidatedGrossSales || 0)}
                </p>
                <span className="text-[11px] text-emerald-600 font-medium mt-1 flex items-center gap-1">
                  <ArrowUpRight className="w-3.5 h-3.5" /> All locations combined
                </span>
              </div>

              <div className="p-4 rounded-2xl theme-surface border border-[var(--theme-border)] shadow-xs">
                <div className="flex items-center justify-between text-[var(--theme-text-secondary)]">
                  <span className="text-xs font-semibold">Consolidated Net Sales</span>
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-2xl sm:text-3xl font-black text-[var(--theme-text-primary)] mt-2 font-mono">
                  {formatCurrency(overview?.consolidatedNetSales || 0)}
                </p>
                <span className="text-[11px] text-[var(--theme-text-secondary)] mt-1 block">
                  Excludes discounts & refunds
                </span>
              </div>

              <div className="p-4 rounded-2xl theme-surface border border-[var(--theme-border)] shadow-xs">
                <div className="flex items-center justify-between text-[var(--theme-text-secondary)]">
                  <span className="text-xs font-semibold">Total Order Volume</span>
                  <div className="w-8 h-8 rounded-xl bg-violet-500/10 text-violet-600 flex items-center justify-center">
                    <CreditCard className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-2xl sm:text-3xl font-black text-[var(--theme-text-primary)] mt-2 font-mono">
                  {overview?.consolidatedOrders || 0}
                </p>
                <span className="text-[11px] text-[var(--theme-text-secondary)] mt-1 block">
                  Average Order Value: {formatCurrency(overview?.averageBasketSize || 0)}
                </span>
              </div>

              <div className="p-4 rounded-2xl theme-surface border border-[var(--theme-border)] shadow-xs">
                <div className="flex items-center justify-between text-[var(--theme-text-secondary)]">
                  <span className="text-xs font-semibold">Active Locations & Terminals</span>
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                    <Store className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-2xl sm:text-3xl font-black text-[var(--theme-text-primary)] mt-2 font-mono">
                  {overview?.totalStores || 1} <span className="text-base text-[var(--theme-text-secondary)] font-normal">stores</span>
                </p>
                <span className="text-[11px] text-[var(--theme-text-secondary)] mt-1 block">
                  {overview?.activeTerminals || 1} registered terminals online
                </span>
              </div>
            </div>

            {/* Store-by-Store Comparative Performance Matrix */}
            <div className="p-5 rounded-2xl theme-surface border border-[var(--theme-border)] space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-[var(--theme-text-primary)]">
                    Store-by-Store Performance Matrix
                  </h3>
                  <p className="text-xs text-[var(--theme-text-secondary)]">
                    Real-time revenue and operational breakdown across store locations
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-[var(--theme-text-secondary)]">
                  <thead className="bg-[var(--theme-surface-variant)] border-b border-[var(--theme-border)] text-[var(--theme-text-primary)] font-bold uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Store Location</th>
                      <th className="py-3 px-4 text-right">Gross Sales</th>
                      <th className="py-3 px-4 text-right">Net Sales</th>
                      <th className="py-3 px-4 text-center">Orders</th>
                      <th className="py-3 px-4 text-right">Average Basket</th>
                      <th className="py-3 px-4 text-center">Terminals</th>
                      <th className="py-3 px-4 text-center">Low Stock</th>
                      <th className="py-3 px-4 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--theme-border)]">
                    {overview?.storeMetrics.map(metric => {
                      const isCurrentActive = metric.storeId === currentStoreId;
                      return (
                        <tr key={metric.storeId} className="hover:bg-[var(--theme-surface-variant)] transition-colors">
                          <td className="py-3.5 px-4 font-semibold text-[var(--theme-text-primary)]">
                            <div className="flex items-center gap-2">
                              <Store className="w-4 h-4 text-blue-600 shrink-0" />
                              <span>{metric.storeName}</span>
                              {isCurrentActive && (
                                <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-bold">
                                  ACTIVE POS
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-[var(--theme-text-primary)]">
                            {formatCurrency(metric.grossSales, metric.currency)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-600">
                            {formatCurrency(metric.netSales, metric.currency)}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono">
                            {metric.orderCount}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono">
                            {formatCurrency(metric.averageBasket, metric.currency)}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className="px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold">
                              {metric.activeTerminals} online
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {metric.lowStockCount > 0 ? (
                              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-bold text-[10px]">
                                {metric.lowStockCount} alerts
                              </span>
                            ) : (
                              <span className="text-emerald-600 font-medium text-[11px]">Healthy</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {!isCurrentActive ? (
                              <button
                                onClick={() => switchStore(metric.storeId)}
                                className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors cursor-pointer"
                              >
                                Switch POS Here
                              </button>
                            ) : (
                              <span className="text-[11px] text-[var(--theme-text-secondary)] font-medium">Selected</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: GLOBAL INVENTORY LEDGER */}
        {activeTab === 'inventory' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 absolute left-3 top-3 text-[var(--theme-text-secondary)]" />
                <input
                  type="text"
                  placeholder="Search catalog by product name, SKU, or barcode..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-[var(--theme-surface-variant)] border border-[var(--theme-border)] text-xs text-[var(--theme-text-primary)] placeholder-[var(--theme-text-secondary)] focus:outline-hidden focus:border-blue-500"
                />
              </div>
              <div className="text-xs text-[var(--theme-text-secondary)]">
                Showing {filteredInventory.length} products across {availableStores.length} stores
              </div>
            </div>

            <div className="p-4 rounded-2xl theme-surface border border-[var(--theme-border)] overflow-x-auto">
              <table className="w-full text-left text-xs text-[var(--theme-text-secondary)]">
                <thead className="bg-[var(--theme-surface-variant)] border-b border-[var(--theme-border)] text-[var(--theme-text-primary)] font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Product Details</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-center">Total Stock</th>
                    {availableStores.map(st => (
                      <th key={st.id} className="py-3 px-4 text-center">
                        {st.name} Stock
                      </th>
                    ))}
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--theme-border)]">
                  {filteredInventory.map(item => (
                    <tr key={item.productId} className="hover:bg-[var(--theme-surface-variant)] transition-colors">
                      <td className="py-3 px-4 font-semibold text-[var(--theme-text-primary)]">
                        <div>
                          <span>{item.productName}</span>
                          <span className="text-[10px] text-[var(--theme-text-secondary)] block font-mono">
                            SKU: {item.sku || 'N/A'} • Barcode: {item.barcode || 'N/A'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[var(--theme-text-secondary)]">
                        {item.categoryName}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-[var(--theme-text-primary)]">
                        {item.totalStock}
                      </td>
                      {item.storeStocks.map(ss => (
                        <td key={ss.storeId} className="py-3 px-4 text-center font-mono">
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold text-[11px] ${
                              ss.isLowStock
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                : 'text-[var(--theme-text-primary)]'
                            }`}
                          >
                            {ss.quantity}
                          </span>
                        </td>
                      ))}
                      <td className="py-3 px-4 text-center">
                        {item.isLowStock ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-bold text-[10px]">
                            Low Stock
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold text-[10px]">
                            In Stock
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: STAFF & ROLES (RBAC) */}
        {activeTab === 'staff' && (
          <div className="p-4 sm:p-5 rounded-2xl theme-surface border border-[var(--theme-border)] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[var(--theme-text-primary)]">
                  Multi-Store Staff & Role-Based Access Control
                </h3>
                <p className="text-xs text-[var(--theme-text-secondary)]">
                  Assign employees to stores with defined administrative privileges
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[var(--theme-text-secondary)]">
                <thead className="bg-[var(--theme-surface-variant)] border-b border-[var(--theme-border)] text-[var(--theme-text-primary)] font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Staff Member</th>
                    <th className="py-3 px-4">Assigned Store</th>
                    <th className="py-3 px-4 text-center">Role / Privilege</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--theme-border)]">
                  {staffList.map(member => (
                    <tr key={member.id} className="hover:bg-[var(--theme-surface-variant)] transition-colors">
                      <td className="py-3.5 px-4 font-bold text-[var(--theme-text-primary)]">
                        {member.fullName}
                      </td>
                      <td className="py-3.5 px-4 text-[var(--theme-text-secondary)]">
                        <div className="flex items-center gap-1.5">
                          <Store className="w-3.5 h-3.5 text-blue-600" />
                          <span>{member.storeName}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full uppercase text-[10px] font-bold ${
                            member.role === 'owner'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                              : member.role === 'manager'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                          }`}
                        >
                          {member.role}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-[var(--theme-text-secondary)]">
                        {member.email || member.phone || 'No contact provided'}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {member.isActive ? (
                          <span className="text-emerald-600 font-bold text-[11px]">Active</span>
                        ) : (
                          <span className="text-rose-600 font-bold text-[11px]">Suspended</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: CASH SHIFT AUDITS */}
        {activeTab === 'shifts' && (
          <div className="p-4 sm:p-5 rounded-2xl theme-surface border border-[var(--theme-border)] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[var(--theme-text-primary)]">
                  Cash Shifts & Terminal Reconciliation
                </h3>
                <p className="text-xs text-[var(--theme-text-secondary)]">
                  Track shift opening floats, closing counts, and discrepancy audits
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[var(--theme-text-secondary)]">
                <thead className="bg-[var(--theme-surface-variant)] border-b border-[var(--theme-border)] text-[var(--theme-text-primary)] font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Shift ID</th>
                    <th className="py-3 px-4">Store & Terminal</th>
                    <th className="py-3 px-4">Cashier</th>
                    <th className="py-3 px-4 text-right">Opening Float</th>
                    <th className="py-3 px-4 text-right">Closing Count</th>
                    <th className="py-3 px-4 text-right">Discrepancy</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--theme-border)]">
                  {cashShifts.map(s => (
                    <tr key={s.id} className="hover:bg-[var(--theme-surface-variant)] transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-[var(--theme-text-primary)]">
                        {s.id.substring(0, 12)}
                      </td>
                      <td className="py-3.5 px-4 text-[var(--theme-text-secondary)]">
                        <span className="font-semibold text-[var(--theme-text-primary)] block">
                          {s.storeName}
                        </span>
                        <span className="text-[10px] text-[var(--theme-text-secondary)]">{s.terminalName}</span>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-[var(--theme-text-primary)]">
                        {s.userName}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono">
                        {formatCurrency(s.openingAmount)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono">
                        {s.closingAmount !== null ? formatCurrency(s.closingAmount) : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold">
                        {s.difference !== null ? (
                          s.difference === 0 ? (
                            <span className="text-emerald-600">Exact</span>
                          ) : (
                            <span className={s.difference < 0 ? 'text-rose-600' : 'text-blue-600'}>
                              {formatCurrency(s.difference)}
                            </span>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            s.status === 'open'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: STORE LOCATIONS DIRECTORY */}
        {activeTab === 'locations' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {availableStores.map(store => {
              const isCurrent = store.id === currentStoreId;
              return (
                <div
                  key={store.id}
                  className={`p-5 rounded-2xl border transition-all ${
                    isCurrent
                      ? 'bg-blue-500/5 border-blue-500/30 shadow-md'
                      : 'theme-surface border-[var(--theme-border)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0">
                        <Store className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-[var(--theme-text-primary)]">
                          {store.name}
                        </h4>
                        <span className="text-xs text-[var(--theme-text-secondary)] font-mono">
                          ID: {store.id}
                        </span>
                      </div>
                    </div>
                    {isCurrent ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Active Register
                      </span>
                    ) : (
                      <button
                        onClick={() => switchStore(store.id)}
                        className="px-3 py-1 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
                      >
                        Select Store
                      </button>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-[var(--theme-border)] grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-[var(--theme-text-secondary)] block uppercase">Address</span>
                      <span className="text-[var(--theme-text-primary)] font-medium">
                        {store.address || 'Address unconfigured'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[var(--theme-text-secondary)] block uppercase">Currency</span>
                      <span className="text-[var(--theme-text-primary)] font-mono font-bold">
                        {store.currency || '$'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
