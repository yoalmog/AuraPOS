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
      <header className="h-16 theme-surface border-b border-[var(--theme-border)] px-3 sm:px-5 flex items-center justify-between gap-2 sm:gap-3 sticky top-0 z-30 shrink-0 select-none">
        {/* Left: Mobile Menu / Collapse Toggle & Route Title */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
          {/* Mobile Hamburger Drawer Toggle (Touch target >= 48px) */}
          <button
            type="button"
            onClick={toggleMobileSidebar}
            className="min-h-[48px] min-w-[48px] p-3 -ml-2 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-surface-variant)] rounded-xl transition-colors lg:hidden shrink-0 flex items-center justify-center cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
            title="Open navigation menu"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Desktop Sidebar Collapse Toggle */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden lg:flex min-h-[44px] min-w-[44px] p-2.5 -ml-1 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-surface-variant)] rounded-xl transition-colors shrink-0 items-center justify-center cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="w-5 h-5 text-[var(--theme-primary)]" />
            ) : (
              <PanelLeftClose className="w-5 h-5" />
            )}
          </button>

          <h1 className="text-base sm:text-lg font-bold text-[var(--theme-text-primary)] tracking-tight truncate whitespace-nowrap">
            {getPageTitle()}
          </h1>
          {activeRoute === 'pos' && cartItems.length > 0 && (
            <span className="hidden md:inline-flex text-xs font-semibold text-[var(--theme-primary)] bg-[var(--theme-surface-variant)] px-2.5 py-0.5 rounded-md border border-[var(--theme-border)] shrink-0">
              {cartItems.reduce((acc, i) => acc + i.quantity, 0)} {t('header.itemsInTicket', 'items')}
            </span>
          )}
        </div>

        {/* Center: Search & Barcode Input (Highlighted in POS view) */}
        {activeRoute === 'pos' && (
          <div className="flex-1 max-w-md mx-2 relative">
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--theme-text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="pos-search-input"
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('header.search', 'Search products by name, SKU, or scan barcode...')}
                className="w-full bg-[var(--theme-bg)] hover:bg-[var(--theme-surface-variant)] focus:bg-[var(--theme-surface)] text-[var(--theme-text-primary)] text-xs rounded-xl pl-9 pr-16 py-2.5 border border-[var(--theme-border)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)] transition-all placeholder:text-[var(--theme-text-disabled)]"
                aria-label="Search products or scan barcode"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="p-1 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] rounded cursor-pointer"
                    title="Clear search"
                    aria-label="Clear search input"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className="text-[10px] font-mono text-[var(--theme-text-secondary)] bg-[var(--theme-surface-variant)] px-1.5 py-0.5 rounded border border-[var(--theme-border)]">
                  F2
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Right Action Icons with accessible min 48px touch targets */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Held Orders Quick Access */}
          {activeRoute === 'pos' && (
            <button
              onClick={() => setOpenHeldOrdersModal(true)}
              className="relative flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-xs font-semibold text-[var(--theme-text-primary)] bg-[var(--theme-surface)] hover:bg-[var(--theme-surface-variant)] border border-[var(--theme-border)] rounded-xl transition-colors cursor-pointer"
              title="Held Orders (F5)"
              aria-label={`Held Orders: ${heldOrders.length} orders on hold. Press F5.`}
            >
              <Clock className="w-4 h-4 text-[var(--theme-text-secondary)]" />
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
              className={`flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-xs font-medium border rounded-xl transition-all cursor-pointer ${
                activeCustomer
                  ? 'border-[var(--theme-primary)] bg-[var(--theme-surface-variant)] text-[var(--theme-primary)] font-semibold'
                  : 'border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-primary)] hover:bg-[var(--theme-surface-variant)]'
              }`}
              title="Customer Loyalty (F3)"
              aria-label={activeCustomer ? `Customer: ${activeCustomer.firstName} ${activeCustomer.lastName}` : 'Add Customer Loyalty (F3)'}
            >
              <Users className="w-4 h-4 text-[var(--theme-primary)]" />
              <span className="max-w-[120px] truncate">
                {activeCustomer ? `${activeCustomer.firstName} ${activeCustomer.lastName}` : t('header.addCustomer', 'Add Customer')}
              </span>
            </button>
          )}

          {/* Network connectivity status with Icon + Text (Not color alone) */}
          <div
            className={`flex items-center gap-1.5 min-h-[40px] px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
              isOffline
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
            }`}
            title={isOffline ? 'Network Offline: Local terminal database active' : 'Network Online: Cloud sync connected'}
            aria-label={isOffline ? 'Network status: Offline. Operating in local database mode.' : 'Network status: Online and synchronized.'}
            role="status"
          >
            {isOffline ? <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400" /> : <Wifi className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
            <span className="hidden lg:inline">{isOffline ? t('header.offline', 'Offline') : t('header.online', 'Online')}</span>
          </div>

          {/* Keyboard Shortcuts Trigger (48px Touch Target) */}
          <button
            onClick={() => setShowShortcuts(true)}
            className="min-h-[48px] min-w-[48px] p-3 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-surface-variant)] rounded-xl transition-colors border border-transparent hover:border-[var(--theme-border)] flex items-center justify-center cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
            title="POS Keyboard Shortcuts"
            aria-label="POS Keyboard input shortcuts"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          {/* Language Selector Dropdown (48px Touch Target) */}
          <div className="relative">
            <button
              onClick={() => setShowLanguageMenu(prev => !prev)}
              className="flex items-center gap-1.5 min-h-[44px] px-2.5 py-2 rounded-xl hover:bg-[var(--theme-surface-variant)] border border-[var(--theme-border)] transition-colors text-xs font-semibold text-[var(--theme-text-primary)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
              title="Select Language"
              aria-label={`Language selector. Current language: ${currentLang.nativeName}`}
              aria-expanded={showLanguageMenu}
            >
              <span className="text-sm">{currentLang.flag}</span>
              <span className="hidden sm:inline">{currentLang.code.toUpperCase()}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-text-secondary)]" />
            </button>

            {showLanguageMenu && (
              <div className="absolute right-0 mt-2 w-52 theme-surface rounded-xl shadow-xl border border-[var(--theme-border)] py-1.5 z-50 animate-fadeIn">
                <div className="px-3 py-1.5 border-b border-[var(--theme-divider)] text-[10px] uppercase font-bold text-[var(--theme-text-secondary)]">
                  {t('header.language', 'Language')}
                </div>
                <div className="py-1 max-h-64 overflow-y-auto">
                  {SUPPORTED_LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        setLanguage(lang.code);
                        setShowLanguageMenu(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors cursor-pointer ${
                        lang.code === language
                          ? 'bg-[var(--theme-surface-variant)] text-[var(--theme-primary)] font-bold'
                          : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-surface-variant)]'
                      }`}
                      aria-label={`Switch language to ${lang.nativeName}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{lang.flag}</span>
                        <span>{lang.nativeName}</span>
                      </div>
                      {lang.code === language && <Check className="w-4 h-4 text-[var(--theme-primary)]" />}
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
              className="min-h-[44px] min-w-[44px] p-2.5 text-[var(--theme-text-secondary)] hover:text-[var(--theme-primary)] hover:bg-[var(--theme-surface-variant)] rounded-xl transition-colors border border-[var(--theme-border)] flex items-center justify-center cursor-pointer"
              title={t('printers.openFullTab', 'Open in Dedicated Tab (Enables Bluetooth)')}
              aria-label="Open in Dedicated Tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}

          {/* Cashier profile menu (48px touch target) */}
          <div className="relative">
            <button
              onClick={() => setShowEmployeeMenu(prev => !prev)}
              className="flex items-center gap-2 min-h-[44px] pl-2 pr-2 py-1 rounded-xl hover:bg-[var(--theme-surface-variant)] border border-[var(--theme-border)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
              title={`Cashier: ${currentEmployee.name}`}
              aria-label={`User session. Current cashier: ${currentEmployee.name}`}
              aria-expanded={showEmployeeMenu}
            >
              <div className="w-7 h-7 rounded-lg bg-[var(--theme-primary)] text-[var(--theme-button-text)] flex items-center justify-center text-xs font-bold shrink-0">
                {currentEmployee.name.split(' ').map(n => n[0]).join('')}
              </div>
              <span className="text-xs font-semibold text-[var(--theme-text-primary)] hidden sm:inline">{currentEmployee.name}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-text-secondary)]" />
            </button>

            {/* Dropdown for Switching Staff */}
            {showEmployeeMenu && (
              <div className="absolute right-0 mt-2 w-60 theme-surface rounded-xl shadow-xl border border-[var(--theme-border)] py-2 z-50">
                <div className="px-3.5 py-1.5 border-b border-[var(--theme-divider)]">
                  <p className="text-[11px] font-semibold uppercase text-[var(--theme-text-secondary)]">{t('header.switchCashier', 'Switch Cashier')}</p>
                </div>
                <div className="py-1">
                  {employees.map(emp => (
                    <button
                      key={emp.id}
                      onClick={() => {
                        switchEmployee(emp.id);
                        setShowEmployeeMenu(false);
                      }}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs text-left text-[var(--theme-text-primary)] hover:bg-[var(--theme-surface-variant)] transition-colors cursor-pointer"
                      aria-label={`Switch cashier to ${emp.name}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <UserCheck className="w-4 h-4 text-[var(--theme-text-secondary)]" />
                        <div>
                          <p className="font-semibold text-[var(--theme-text-primary)]">{emp.name}</p>
                          <p className="text-[10px] text-[var(--theme-text-secondary)] capitalize">{emp.role}</p>
                        </div>
                      </div>
                      {emp.id === currentEmployee.id && <Check className="w-4 h-4 text-[var(--theme-primary)]" />}
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
