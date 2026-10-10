import React, { useState, useMemo } from 'react';
import { usePOS } from '../../context/POSContext.tsx';
import { Currency } from '../../utils/currency.ts';
import {
  BarChart3,
  TrendingUp,
  CreditCard,
  ShoppingBag,
  DollarSign,
  Download,
  Calendar,
  Layers,
  Award,
  Users,
  Database,
  CheckCircle2
} from 'lucide-react';

export const ReportsView: React.FC = () => {
  const { sales, products, categories, employees, showToast, isOffline, pendingSyncCount } = usePOS();
  const isLocalDataOnly = isOffline || pendingSyncCount > 0;
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | '7days' | '30days' | 'all'>('7days');

  // Filter sales by date range
  const filteredSales = useMemo(() => {
    const now = new Date();
    return sales.filter(s => {
      const d = new Date(s.createdAt);
      if (dateRange === 'today') {
        return (
          d.getDate() === now.getDate() &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      } else if (dateRange === 'yesterday') {
        const yest = new Date(now);
        yest.setDate(now.getDate() - 1);
        return (
          d.getDate() === yest.getDate() &&
          d.getMonth() === yest.getMonth() &&
          d.getFullYear() === yest.getFullYear()
        );
      } else if (dateRange === '7days') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return d >= weekAgo;
      } else if (dateRange === '30days') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return d >= monthAgo;
      }
      return true;
    });
  }, [sales, dateRange]);

  // Executive Metrics
  const grossSales = useMemo(() => {
    const cents = filteredSales.reduce((acc, s) => acc + Currency.toCents(s.subtotal), 0);
    return Currency.toDollars(cents);
  }, [filteredSales]);

  const netSales = useMemo(() => {
    const cents = filteredSales
      .filter(s => s.status !== 'refunded')
      .reduce((acc, s) => acc + Math.max(0, Currency.toCents(s.subtotal) - Currency.toCents(s.discountAmount)), 0);
    return Currency.toDollars(cents);
  }, [filteredSales]);

  const totalDiscounts = useMemo(() => {
    const cents = filteredSales.reduce((acc, s) => acc + Currency.toCents(s.discountAmount), 0);
    return Currency.toDollars(cents);
  }, [filteredSales]);

  const totalTaxes = useMemo(() => {
    const cents = filteredSales.reduce((acc, s) => acc + Currency.toCents(s.taxAmount), 0);
    return Currency.toDollars(cents);
  }, [filteredSales]);

  const ordersCount = filteredSales.length;

  const averageBasket = useMemo(() => {
    if (ordersCount === 0) return 0;
    const netCents = Currency.toCents(netSales);
    return Currency.toDollars(Math.round(netCents / ordersCount));
  }, [netSales, ordersCount]);

  // Breakdown by Category
  const categorySales = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; count: number }> = {};
    categories.forEach(c => {
      if (c.id !== 'cat_all' && c.id !== 'cat_fav') {
        map[c.id] = { name: c.name, revenue: 0, count: 0 };
      }
    });

    filteredSales.forEach(s => {
      s.items.forEach(i => {
        const prod = products.find(p => p.id === i.productId);
        if (prod && map[prod.categoryId]) {
          map[prod.categoryId].revenue += i.lineTotal;
          map[prod.categoryId].count += i.quantity;
        }
      });
    });

    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [categories, filteredSales, products]);

  // Top Products
  const topProducts = useMemo(() => {
    const map: Record<string, { name: string; qty: number; revenue: number }> = {};
    filteredSales.forEach(s => {
      s.items.forEach(i => {
        if (!map[i.productId]) {
          map[i.productId] = { name: i.productName, qty: 0, revenue: 0 };
        }
        map[i.productId].qty += i.quantity;
        map[i.productId].revenue += i.lineTotal;
      });
    });

    return Object.values(map)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [filteredSales]);

  // Payment methods breakdown
  const paymentBreakdown = useMemo(() => {
    const map: Record<string, number> = {
      cash: 0,
      card: 0,
      mobile: 0,
      bank: 0,
      loyalty: 0
    };
    filteredSales.forEach(s => {
      s.payments.forEach(p => {
        if (map[p.method] !== undefined) {
          map[p.method] += p.amount;
        } else {
          map.cash += p.amount;
        }
      });
    });
    return map;
  }, [filteredSales]);

  // Cashier performance
  const employeeLeaderboard = useMemo(() => {
    const map: Record<string, { name: string; salesCount: number; total: number }> = {};
    employees.forEach(e => {
      map[e.id] = { name: e.name, salesCount: 0, total: 0 };
    });

    filteredSales.forEach(s => {
      if (map[s.employeeId]) {
        map[s.employeeId].salesCount += 1;
        map[s.employeeId].total += s.total;
      }
    });

    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [employees, filteredSales]);

  const handleExportReportCSV = () => {
    const lines = [
      'AuraPOS - Executive Financial Report',
      `Period: ${dateRange.toUpperCase()}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      'SUMMARY METRICS',
      `Gross Sales,${grossSales.toFixed(2)}`,
      `Net Sales,${netSales.toFixed(2)}`,
      `Total Discounts,${totalDiscounts.toFixed(2)}`,
      `Total Taxes Collected,${totalTaxes.toFixed(2)}`,
      `Total Tickets,${ordersCount}`,
      `Average Basket,${averageBasket.toFixed(2)}`,
      '',
      'CATEGORY BREAKDOWN',
      'Category,Revenue,Units Sold',
      ...categorySales.map(c => `"${c.name}",${c.revenue.toFixed(2)},${c.count}`),
      '',
      'TOP PRODUCTS',
      'Product,Quantity,Revenue',
      ...topProducts.map(tp => `"${tp.name}",${tp.qty},${tp.revenue.toFixed(2)}`)
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sales_report_${dateRange}_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast({ type: 'success', title: 'Financial Report Exported to CSV' });
  };

  const maxCatRev = Math.max(...categorySales.map(c => c.revenue), 1);

  return (
    <div className="flex-1 bg-slate-50 p-6 overflow-y-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Business Analytics & Reports</h2>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                  isLocalDataOnly
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                }`}
              >
                {isLocalDataOnly ? <Database className="w-3 h-3 text-amber-600" /> : <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                <span>
                  {isLocalDataOnly
                    ? `LOCAL DATA ${isOffline ? '(Offline)' : `(${pendingSyncCount} unsynced)`}`
                    : 'CLOUD DATA (Synchronized)'}
                </span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time sales performance, category revenue distribution, and staff leaderboards
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Date range picker */}
            <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
              {[
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: '7days', label: 'Last 7 Days' },
                { id: '30days', label: 'Last 30 Days' },
                { id: 'all', label: 'All Time' }
              ].map(d => (
                <button
                  key={d.id}
                  onClick={() => setDateRange(d.id as any)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    dateRange === d.id
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <button
              onClick={handleExportReportCSV}
              className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 shadow-2xs transition-colors"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Executive Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-semibold text-slate-500 block">Gross Sales</span>
            <p className="text-xl font-mono font-bold text-slate-900 mt-1 tabular-nums">
              ${grossSales.toFixed(2)}
            </p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-semibold text-emerald-700 block">Net Revenue</span>
            <p className="text-xl font-mono font-bold text-emerald-600 mt-1 tabular-nums">
              ${netSales.toFixed(2)}
            </p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-semibold text-slate-500 block">Completed Orders</span>
            <p className="text-xl font-mono font-bold text-slate-900 mt-1 tabular-nums">{ordersCount}</p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-semibold text-slate-500 block">Average Basket</span>
            <p className="text-xl font-mono font-bold text-slate-900 mt-1 tabular-nums">
              ${averageBasket.toFixed(2)}
            </p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-semibold text-slate-500 block">Discounts Given</span>
            <p className="text-xl font-mono font-bold text-slate-700 mt-1 tabular-nums">
              ${totalDiscounts.toFixed(2)}
            </p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-semibold text-slate-500 block">Taxes Collected</span>
            <p className="text-xl font-mono font-bold text-slate-700 mt-1 tabular-nums">
              ${totalTaxes.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Middle Row: Category Revenue Bar Distribution & Top Products */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Category Bar Breakdown (7 cols) */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
              <Layers className="w-4 h-4 text-blue-600" />
              <span>Sales by Category</span>
            </h3>

            <div className="space-y-3.5">
              {categorySales.map(cat => {
                const percent = (cat.revenue / maxCatRev) * 100;
                return (
                  <div key={cat.name} className="space-y-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-800">{cat.name}</span>
                      <span className="font-mono text-slate-900">${cat.revenue.toFixed(2)} ({cat.count} units)</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top 5 Best Sellers (5 cols) */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
              <Award className="w-4 h-4 text-amber-500" />
              <span>Top 5 Best Selling Items</span>
            </h3>

            <div className="space-y-3">
              {topProducts.map((tp, idx) => (
                <div
                  key={tp.name}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-slate-50/50"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 font-bold text-[10px] flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="truncate">
                      <p className="text-xs font-bold text-slate-900 truncate">{tp.name}</p>
                      <p className="text-[11px] text-slate-500">{tp.qty} sold</p>
                    </div>
                  </div>

                  <span className="font-mono font-bold text-xs text-slate-900 tabular-nums">
                    ${tp.revenue.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Row: Payment Methods & Staff Leaderboard */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Payment breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
              <CreditCard className="w-4 h-4 text-blue-600" />
              <span>Tender & Payment Method Breakdown</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.entries(paymentBreakdown).map(([method, amount]) => (
                <div key={method} className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-bold uppercase text-slate-500">{method}</span>
                  <p className="text-lg font-bold font-mono text-slate-900 mt-0.5 tabular-nums">
                    ${amount.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Cashier Leaderboard */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-purple-600" />
              <span>Cashier Sales Performance</span>
            </h3>

            <div className="space-y-2.5">
              {employeeLeaderboard.map((emp, idx) => (
                <div
                  key={emp.name}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-slate-50/50"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                      {emp.name.split(' ').map(n => n[0]).join('')}
                    </span>
                    <div>
                      <p className="text-xs font-bold text-slate-900">{emp.name}</p>
                      <p className="text-[10px] text-slate-400">{emp.salesCount} tickets processed</p>
                    </div>
                  </div>

                  <span className="font-mono font-bold text-xs text-slate-900 tabular-nums">
                    ${emp.total.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
