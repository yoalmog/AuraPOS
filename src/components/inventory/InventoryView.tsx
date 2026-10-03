import React, { useState, useMemo } from 'react';
import { usePOS } from '../../context/POSContext.tsx';
import { Product, InventoryMovement } from '../../types/pos.ts';
import { PosService } from '../../services/posService.ts';
import {
  Layers,
  AlertTriangle,
  PackageCheck,
  TrendingDown,
  DollarSign,
  Plus,
  Minus,
  Edit3,
  History,
  Search,
  Filter,
  X
} from 'lucide-react';

export const InventoryView: React.FC = () => {
  const {
    products,
    categories,
    inventoryMovements,
    currentEmployee,
    refreshData,
    showToast,
    isOwner,
    requireOwnerAuth,
    translateProductName,
    t
  } = usePOS();

  const [activeTab, setActiveTab] = useState<'stock' | 'movements'>('stock');
  const [search, setSearch] = useState<string>('');
  const [filterStockStatus, setFilterStockStatus] = useState<'all' | 'low' | 'out'>('all');

  // Adjustment Modal
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);
  const [adjType, setAdjType] = useState<'add' | 'remove' | 'set'>('add');
  const [adjQuantity, setAdjQuantity] = useState<string>('5');
  const [adjReason, setAdjReason] = useState<string>('Purchase / Restock');
  const [adjNotes, setAdjNotes] = useState<string>('');

  // Dashboard calculations
  const totalProducts = products.length;
  const lowStockProducts = products.filter(p => p.trackInventory && p.stock > 0 && p.stock <= p.lowStockThreshold);
  const outOfStockProducts = products.filter(p => p.trackInventory && p.stock <= 0);

  const inventoryRetailValue = useMemo(() => {
    return products.reduce((acc, p) => acc + (p.trackInventory ? p.price * p.stock : 0), 0);
  }, [products]);

  const inventoryCostValue = useMemo(() => {
    return products.reduce((acc, p) => acc + (p.trackInventory ? p.cost * p.stock : 0), 0);
  }, [products]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (filterStockStatus === 'low') {
        if (!p.trackInventory || p.stock <= 0 || p.stock > p.lowStockThreshold) return false;
      } else if (filterStockStatus === 'out') {
        if (!p.trackInventory || p.stock > 0) return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      }
      return true;
    });
  }, [products, filterStockStatus, search]);

  const handleOpenAdjust = (p: Product) => {
    requireOwnerAuth(() => {
      setAdjustingProduct(p);
      setAdjType('add');
      setAdjQuantity('5');
      setAdjReason('Purchase / Restock');
      setAdjNotes('');
    }, t('inventory.adjustOwnerAuth', 'Adjust Inventory Stock Levels'));
  };

  const handleSaveAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingProduct) return;
    const qty = parseInt(adjQuantity, 10);
    if (isNaN(qty) || qty < 0) {
      showToast({ type: 'warning', title: 'Invalid quantity' });
      return;
    }

    requireOwnerAuth(() => {
      const fullReason = adjNotes.trim() ? `${adjReason} - ${adjNotes.trim()}` : adjReason;
      PosService.adjustStock(adjustingProduct.id, adjType, qty, fullReason, currentEmployee);
      refreshData();
      setAdjustingProduct(null);
      showToast({
        type: 'success',
        title: 'Stock Adjusted',
        message: `${adjustingProduct.name} updated.`
      });
    }, 'Confirm Stock Adjustment');
  };

  return (
    <div className="flex-1 bg-slate-50 p-6 overflow-y-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Inventory & Stock Control</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live tracking, inventory valuations, threshold alerts, and audit movements
            </p>
          </div>

          {/* Tab selector */}
          <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
            <button
              onClick={() => setActiveTab('stock')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'stock'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Current Stock</span>
            </button>
            <button
              onClick={() => setActiveTab('movements')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'movements'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Movement History ({inventoryMovements.length})</span>
            </button>
          </div>
        </div>

        {/* Dashboard Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-medium text-slate-500">Tracked Items</span>
            <p className="text-2xl font-bold font-mono text-slate-900 mt-1">{totalProducts}</p>
            <span className="text-[11px] text-slate-400">Total catalog products</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-medium text-amber-600 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Low Stock Warnings
            </span>
            <p className="text-2xl font-bold font-mono text-amber-600 mt-1">{lowStockProducts.length}</p>
            <span className="text-[11px] text-slate-400">Below threshold trigger</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-medium text-rose-600 flex items-center gap-1">
              <TrendingDown className="w-3.5 h-3.5" />
              Out of Stock
            </span>
            <p className="text-2xl font-bold font-mono text-rose-600 mt-1">{outOfStockProducts.length}</p>
            <span className="text-[11px] text-slate-400">Zero inventory balance</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-medium text-slate-500">Total Asset Value</span>
            <p className="text-2xl font-bold font-mono text-emerald-600 mt-1">
              ${inventoryRetailValue.toFixed(2)}
            </p>
            <span className="text-[11px] text-slate-400">Cost: ${inventoryCostValue.toFixed(2)}</span>
          </div>
        </div>

        {activeTab === 'stock' ? (
          <>
            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filter by product name or SKU..."
                  className="w-full text-xs pl-9 pr-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Status:</span>
                <select
                  value={filterStockStatus}
                  onChange={e => setFilterStockStatus(e.target.value as any)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-700 focus:outline-none"
                >
                  <option value="all">All Inventory</option>
                  <option value="low">Low Stock Only ({lowStockProducts.length})</option>
                  <option value="out">Out of Stock Only ({outOfStockProducts.length})</option>
                </select>
              </div>
            </div>

            {/* Inventory Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3.5 px-4">Product Name</th>
                      <th className="py-3.5 px-4">SKU</th>
                      <th className="py-3.5 px-4 text-center">Current Stock</th>
                      <th className="py-3.5 px-4 text-center">Min Threshold</th>
                      <th className="py-3.5 px-4 text-right">Unit Cost</th>
                      <th className="py-3.5 px-4 text-right">Stock Value</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400">
                          {t('inventory.noMovementsFound', 'No inventory records found')}
                        </td>
                      </tr>
                    ) : (
                      filteredProducts.map(p => {
                      const isLow = p.trackInventory && p.stock > 0 && p.stock <= p.lowStockThreshold;
                      const isOut = p.trackInventory && p.stock <= 0;
                      const lineValue = p.stock * p.price;

                      return (
                        <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-slate-900">{p.name}</td>
                          <td className="py-3.5 px-4 font-mono text-slate-500">{p.sku}</td>
                          <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-900">
                            {p.trackInventory ? `${p.stock} ${p.unit}s` : 'Untracked'}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono text-slate-500">
                            {p.trackInventory ? p.lowStockThreshold : '-'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-slate-600">
                            ${p.cost.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                            ${lineValue.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4">
                            {isOut ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                Out of Stock
                              </span>
                            ) : isLow ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                Low Stock ({p.stock})
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700">
                                In Stock
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={() => handleOpenAdjust(p)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 font-semibold text-xs rounded-xl transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Adjust</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          /* Movement History Tab */
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Product</th>
                    <th className="py-3.5 px-4">Type</th>
                    <th className="py-3.5 px-4 text-center">Change</th>
                    <th className="py-3.5 px-4 text-center">Prev → New</th>
                    <th className="py-3.5 px-4">Reason / Notes</th>
                    <th className="py-3.5 px-4">Employee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inventoryMovements.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        {t('inventory.noMovementsFound', 'No inventory movements recorded')}
                      </td>
                    </tr>
                  ) : (
                    inventoryMovements.map(m => {
                    const formattedDate = new Date(m.createdAt).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric'
                    });
                    const formattedTime = new Date(m.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    });

                    return (
                      <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap">
                          {formattedDate} · {formattedTime}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">{m.productName}</td>
                        <td className="py-3.5 px-4">
                          <span className="capitalize px-2 py-0.5 rounded font-semibold text-[10px] bg-slate-100 text-slate-700">
                            {m.type}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono font-bold">
                          <span
                            className={
                              m.quantity > 0
                                ? 'text-emerald-600'
                                : m.quantity < 0
                                ? 'text-rose-600'
                                : 'text-slate-500'
                            }
                          >
                            {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-500">
                          {m.previousQuantity} → {m.newQuantity}
                        </td>
                        <td className="py-3.5 px-4 text-slate-700">{m.reason}</td>
                        <td className="py-3.5 px-4 text-slate-500">{m.employeeName}</td>
                      </tr>
                    );
                  })
                )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Adjust Stock Modal */}
      {adjustingProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-100 overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Adjust Stock Quantity</h3>
                <p className="text-xs text-slate-500 mt-0.5">{adjustingProduct.name}</p>
              </div>
              <button
                onClick={() => setAdjustingProduct(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAdjustment} className="p-6 space-y-4">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                <span className="font-semibold text-slate-600">Current Stock Level:</span>
                <span className="font-mono font-black text-sm text-slate-900">
                  {adjustingProduct.stock} {adjustingProduct.unit}s
                </span>
              </div>

              {/* Adjustment Type Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Adjustment Action
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'add', label: '+ Add Stock' },
                    { id: 'remove', label: '- Remove' },
                    { id: 'set', label: '= Set Level' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setAdjType(tab.id as any)}
                      className={`py-2 text-xs font-bold rounded-xl border transition-all ${
                        adjType === tab.id
                          ? 'border-blue-600 bg-blue-50 text-blue-900 ring-1 ring-blue-600'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={adjQuantity}
                  onChange={e => setAdjQuantity(e.target.value)}
                  className="w-full text-base font-mono font-bold p-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Reason for Adjustment
                </label>
                <select
                  value={adjReason}
                  onChange={e => setAdjReason(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  <option value="Purchase / Restock">Purchase / Restock</option>
                  <option value="Damaged / Spoilage">Damaged / Spoilage</option>
                  <option value="Inventory Count Correction">Inventory Count Correction</option>
                  <option value="Lost / Missing">Lost / Missing</option>
                  <option value="Customer Return">Customer Return</option>
                  <option value="Internal Store Consumption">Internal Store Consumption</option>
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Optional Reference / PO #
                </label>
                <input
                  type="text"
                  placeholder="e.g. Supplier Invoice #9910"
                  value={adjNotes}
                  onChange={e => setAdjNotes(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAdjustingProduct(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs"
                >
                  Save Stock Movement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
