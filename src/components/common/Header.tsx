import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext.tsx';
import {
  Search,
  Barcode,
  Users,
  Clock,
  Keyboard,
  Lock,
  Wifi,
  WifiOff,
  UserCheck,
  Check,
  ChevronDown,
  X,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Globe,
  ExternalLink
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../../i18n/translations.ts';

interface HeaderProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  onBarcodeScan?: (barcode: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ searchTerm, setSearchTerm, onBarcodeScan }) => {
  const {
    activeRoute,
    currentEmployee,
    employees,
    switchEmployee,
    setIsPinLocked,
    heldOrders,
    setOpenHeldOrdersModal,
    activeCustomer,
    setOpenCustomerModal,
    isOffline,
    cartItems,
    isSidebarCollapsed,
    toggleSidebar,
    toggleMobileSidebar,
    language,
    setLanguage,
    t
  } = usePOS();

  const [showShortcuts, setShowShortcuts] = useState<boolean>(false);
  const [showEmployeeMenu, setShowEmployeeMenu] = useState<boolean>(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState<boolean>(false);

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === language) || SUPPORTED_LANGUAGES[0];

  const getPageTitle = () => {
    switch (activeRoute) {
      case 'pos':
        return t('nav.pos', 'Point of Sale');
      case 'checkout':
        return t('checkout.title', 'Checkout Payment');
      case 'sales':
        return t('nav.sales', 'Sales & Receipts');
      case 'products':
        return t('nav.products', 'Products Catalog');
      case 'inventory':
        return t('nav.inventory', 'Inventory & Stock Control');
      case 'customers':
        return t('nav.customers', 'Customer Directory & Loyalty');
      case 'employees':
        return t('nav.employees', 'Staff & Roles Management');
      case 'reports':
        return t('nav.reports', 'Business Analytics & Reports');
      case 'discounts':
        return t('nav.discounts', 'Promotions & Discounts');
      case 'settings':
        return t('nav.settings', 'Store & System Settings');
      default:
        return t('nav.pos', 'Point of Sale');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onBarcodeScan && searchTerm.trim()) {
      onBarcodeScan(searchTerm.trim());
    }
  };

  return (
    <>
      <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-3 sticky top-0 z-10 shrink-0">
        {/* Left: Mobile Menu / Collapse Toggle & Route Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Mobile Hamburger Drawer Toggle */}
          <button
            type="button"
            onClick={toggleMobileSidebar}
            className="p-2 -ml-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors lg:hidden shrink-0"
            title="Open navigation menu"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Desktop Sidebar Collapse Toggle */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden lg:flex p-2 -ml-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors shrink-0"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="w-5 h-5 text-blue-600" />
            ) : (
              <PanelLeftClose className="w-5 h-5 text-slate-500" />
            )}
          </button>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate whitespace-nowrap">
            {getPageTitle()}
          </h2>
          {activeRoute === 'pos' && cartItems.length > 0 && (
            <span className="hidden md:inline-flex text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 shrink-0">
              {cartItems.reduce((acc, i) => acc + i.quantity, 0)} {t('header.itemsInTicket', 'items in ticket')}
            </span>
          )}
        </div>

        {/* Center: Search & Barcode Input (Highlighted in POS view) */}
        {activeRoute === 'pos' && (
          <div className="flex-1 max-w-md mx-2 relative">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="pos-search-input"
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('header.search', 'Search products by name, SKU, or scan barcode...')}
                className="w-full bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-slate-800 text-xs rounded-xl pl-9 pr-16 py-2.5 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-slate-400"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className="text-[10px] font-mono text-slate-400 bg-slate-200/70 px-1.5 py-0.5 rounded">
                  F2
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Right Action Icons */}
        <div className="flex items-center gap-2">
          {/* Held Orders Quick Access */}
          {activeRoute === 'pos' && (
            <button
              onClick={() => setOpenHeldOrdersModal(true)}
              className="relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
              title="Held Orders (F5)"
            >
              <Clock className="w-4 h-4 text-slate-500" />
              <span className="hidden md:inline">{t('header.heldOrders', 'Held Orders')}</span>
              {heldOrders.length > 0 && (
                <span className="w-4 h-4 text-[10px] font-bold bg-amber-500 text-white rounded-full flex items-center justify-center">
                  {heldOrders.length}
                </span>
              )}
            </button>
          )}

          {/* Active Customer Access */}
          {activeRoute === 'pos' && (
            <button
              onClick={() => setOpenCustomerModal(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-xl transition-all ${
                activeCustomer
                  ? 'border-blue-300 bg-blue-50 text-blue-900 font-semibold'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
              title="Customer Loyalty (F3)"
            >
              <Users className="w-4 h-4 text-blue-600" />
              <span className="max-w-[120px] truncate">
                {activeCustomer ? `${activeCustomer.firstName} ${activeCustomer.lastName}` : t('header.addCustomer', 'Add Customer')}
              </span>
            </button>
          )}

          {/* Network connectivity status */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
              isOffline
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-emerald-50 border-emerald-300 text-emerald-900'
            }`}
            title={isOffline ? 'Network Offline' : 'Network Online'}
          >
            {isOffline ? <WifiOff className="w-3.5 h-3.5 text-amber-600" /> : <Wifi className="w-3.5 h-3.5 text-emerald-600" />}
            <span className="hidden lg:inline">{isOffline ? t('header.offline', 'Offline') : t('header.online', 'Online')}</span>
          </div>

          {/* Keyboard Shortcuts Trigger */}
          <button
            onClick={() => setShowShortcuts(true)}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors border border-transparent hover:border-slate-200"
            title="POS Keyboard Shortcuts"
            aria-label="Keyboard Shortcuts"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          {/* Language Selector Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowLanguageMenu(prev => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 border border-slate-200 transition-colors text-xs font-semibold text-slate-700"
              title="Select Language"
            >
              <span className="text-sm">{currentLang.flag}</span>
              <span className="hidden sm:inline">{currentLang.code.toUpperCase()}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showLanguageMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-fadeIn">
                <div className="px-3 py-1 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400">
                  {t('header.language', 'Language')}
                </div>
                <div className="py-1 max-h-60 overflow-y-auto">
                  {SUPPORTED_LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        setLanguage(lang.code);
                        setShowLanguageMenu(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors ${
                        lang.code === language
                          ? 'bg-blue-50 text-blue-700 font-bold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{lang.flag}</span>
                        <span>{lang.nativeName}</span>
                      </div>
                      {lang.code === language && <Check className="w-3.5 h-3.5 text-blue-600" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Iframe Popout button */}
          {typeof window !== 'undefined' && window.self !== window.top && (
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors border border-slate-200"
              title={t('printers.openFullTab', 'Open in Dedicated Tab (Enables Bluetooth)')}
              aria-label="Open in Dedicated Tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}

          {/* Cashier profile menu */}
          <div className="relative">
            <button
              onClick={() => setShowEmployeeMenu(prev => !prev)}
              className="flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-xl hover:bg-slate-100 border border-slate-200 transition-colors"
            >
              <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                {currentEmployee.name.split(' ').map(n => n[0]).join('')}
              </div>
              <span className="text-xs font-medium text-slate-800 hidden sm:inline">{currentEmployee.name}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {/* Dropdown for Switching Staff */}
            {showEmployeeMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50">
                <div className="px-3 py-1.5 border-b border-slate-100">
                  <p className="text-[11px] font-semibold uppercase text-slate-400">{t('header.switchCashier', 'Switch Cashier')}</p>
                </div>
                <div className="py-1">
                  {employees.map(emp => (
                    <button
                      key={emp.id}
                      onClick={() => {
                        switchEmployee(emp.id);
                        setShowEmployeeMenu(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-left text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                        <div>
                          <p className="font-medium text-slate-900">{emp.name}</p>
                          <p className="text-[10px] text-slate-500 capitalize">{emp.role}</p>
                        </div>
                      </div>
                      {emp.id === currentEmployee.id && <Check className="w-4 h-4 text-blue-600" />}
                    </button>
                  ))}
                </div>
                <div className="pt-1 border-t border-slate-100">
                  <button
                    onClick={() => {
                      setShowEmployeeMenu(false);
                      setIsPinLocked(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 font-medium transition-colors"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Lock Register</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Keyboard Shortcuts Dialog */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-blue-600" />
                POS Keyboard Shortcuts
              </h3>
              <button
                onClick={() => setShowShortcuts(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              {[
                { key: 'F1', desc: 'Switch to Point of Sale' },
                { key: 'F2', desc: 'Focus Product Search / Scanner' },
                { key: 'F3', desc: 'Open Customer Selection' },
                { key: 'F4', desc: 'Hold Open Order' },
                { key: 'F5', desc: 'View Held Tickets' },
                { key: 'F6', desc: 'Apply Discount' },
                { key: 'F7', desc: 'Proceed to Checkout' },
                { key: 'ESC', desc: 'Close any active modal' },
              ].map(shortcut => (
                <div key={shortcut.key} className="flex items-center justify-between py-1 border-b border-slate-50">
                  <span className="text-slate-600">{shortcut.desc}</span>
                  <span className="font-mono font-bold bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-300">
                    {shortcut.key}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
