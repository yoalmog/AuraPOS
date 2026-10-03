import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext.tsx';
import {
  Trash2,
  Plus,
  Minus,
  Tag,
  Users,
  Clock,
  RotateCcw,
  CreditCard,
  UserCheck,
  X,
  FileText,
  ShoppingBag
} from 'lucide-react';

interface CartPanelProps {
  isOpenOnMobile?: boolean;
  onCloseMobile?: () => void;
}

export const CartPanel: React.FC<CartPanelProps> = ({ isOpenOnMobile = false, onCloseMobile }) => {
  const {
    cartItems,
    updateCartItemQty,
    removeCartItem,
    clearCart,
    subtotal,
    discountAmount,
    activeDiscount,
    setActiveDiscount,
    taxAmount,
    taxRate,
    grandTotal,
    activeCustomer,
    setActiveCustomer,
    holdCurrentOrder,
    setActiveRoute,
    setOpenCustomerModal,
    setOpenDiscountModal,
    settings,
    cartNotes,
    setCartNotes,
    t,
    translateProductName
  } = usePOS();

  const [showNotesInput, setShowNotesInput] = useState<boolean>(false);

  return (
    <div
      className={`border-l border-slate-200 bg-white flex flex-col select-none shadow-sm shrink-0 ${
        isOpenOnMobile
          ? 'fixed inset-0 z-50 overflow-hidden'
          : 'hidden lg:flex w-80 xl:w-96 h-[calc(100vh-4rem)] sticky top-16 z-10'
      }`}
    >
      {/* Ticket Header & Customer Tag */}
      <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="lg:hidden p-1.5 -ml-1 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-200 transition-colors"
                aria-label="Back to products"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {t('pos.currentTicket', 'Current Order')}
            </span>
            <span className="font-mono text-xs font-bold text-slate-800 bg-slate-200/80 px-2 py-0.5 rounded">
              #{settings.receiptPrefix}{settings.nextReceiptNumber}
            </span>
          </div>

          {cartItems.length > 0 && (
            <button
              onClick={clearCart}
              className="text-[11px] font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2 py-1 rounded transition-colors"
            >
              {t('pos.clear', 'Clear Cart')}
            </button>
          )}
        </div>

        {/* Customer Bar */}
        <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-2 px-3">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-blue-600 shrink-0" />
            {activeCustomer ? (
              <div className="truncate">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {activeCustomer.firstName} {activeCustomer.lastName}
                </p>
                <p className="text-[10px] text-blue-600 font-medium">
                  {activeCustomer.loyaltyPoints} {t('pos.loyaltyPoints', 'loyalty points')}
                </p>
              </div>
            ) : (
              <span className="text-xs text-slate-500">{t('pos.walkInCustomer', 'Walk-in Customer')}</span>
            )}
          </div>

          {activeCustomer ? (
            <button
              onClick={() => setActiveCustomer(null)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded"
              title="Remove customer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => setOpenCustomerModal(true)}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors"
            >
              + {t('pos.addCustomer', 'Add')}
            </button>
          )}
        </div>
      </div>

      {/* Cart Items List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {cartItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
              <ShoppingBag className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-sm font-semibold text-slate-700">{t('pos.emptyCart', 'Ticket is empty')}</p>
            <p className="text-xs text-slate-400 mt-1 max-w-[200px]">
              {t('pos.emptyCartSub', 'Tap items from the menu or scan a barcode to add.')}
            </p>
          </div>
        ) : (
          cartItems.map(item => (
            <div
              key={item.id}
              className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors gap-2"
            >
              {/* Product Thumbnail if available */}
              {item.imageUrl ? (
                <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 shadow-2xs border border-slate-200 bg-white">
                  <img
                    src={item.imageUrl}
                    alt={item.productName}
                    className="w-full h-full object-cover"
                    onError={e => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
              ) : (
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 shadow-2xs text-xs font-bold"
                  style={{
                    backgroundColor: item.color ? `${item.color}15` : '#EFF6FF',
                    color: item.color || '#2563EB'
                  }}
                >
                  {item.productName.charAt(0)}
                </div>
              )}

              {/* Product Info */}
              <div className="min-w-0 flex-1">
                <h5 className="text-xs font-semibold text-slate-900 truncate">
                  {translateProductName(item.productId, item.productName)}
                </h5>
                {item.variantName && (
                  <p className="text-[11px] text-blue-600 font-medium truncate">{item.variantName}</p>
                )}
                <p className="text-xs font-mono text-slate-500 mt-0.5">
                  ${item.unitPrice.toFixed(2)} {t('pos.each', 'each')}
                </p>
              </div>

              {/* Quantity Stepper */}
              <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 shadow-2xs">
                <button
                  type="button"
                  onClick={() => updateCartItemQty(item.id, item.quantity - 1)}
                  className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 active:scale-95 transition-all"
                  aria-label="Decrease quantity"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="w-5 text-center font-mono text-xs font-bold text-slate-800">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => updateCartItemQty(item.id, item.quantity + 1)}
                  className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 active:scale-95 transition-all"
                  aria-label="Increase quantity"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              {/* Line Total & Remove */}
              <div className="text-right min-w-[55px] pl-1">
                <p className="text-xs font-bold font-mono text-slate-900">
                  ${(item.unitPrice * item.quantity).toFixed(2)}
                </p>
                <button
                  onClick={() => removeCartItem(item.id)}
                  className="text-slate-300 hover:text-rose-500 p-0.5 rounded transition-colors"
                  title="Remove item"
                >
                  <Trash2 className="w-3.5 h-3.5 ml-auto" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Cart Summary & Financial Totals */}
      <div className="p-4 border-t border-slate-200 bg-slate-50/50 space-y-2">
        {/* Subtotal */}
        <div className="flex justify-between text-xs text-slate-600">
          <span>{t('pos.subtotal', 'Subtotal')}</span>
          <span className="font-mono tabular-nums font-medium">${subtotal.toFixed(2)}</span>
        </div>

        {/* Discount Row */}
        {discountAmount > 0 && (
          <div className="flex justify-between text-xs text-emerald-700 items-center">
            <span className="flex items-center gap-1">
              <Tag className="w-3 h-3" />
              {activeDiscount ? activeDiscount.name : t('pos.discount', 'Discount')}
            </span>
            <div className="flex items-center gap-1.5 font-mono font-medium">
              <span>-${discountAmount.toFixed(2)}</span>
              <button
                onClick={() => setActiveDiscount(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Tax */}
        <div className="flex justify-between text-xs text-slate-600">
          <span>{t('pos.tax', 'Tax')} ({(taxRate * 100).toFixed(2)}%)</span>
          <span className="font-mono tabular-nums font-medium">${taxAmount.toFixed(2)}</span>
        </div>

        {/* Grand Total */}
        <div className="pt-2 border-t border-slate-200 flex justify-between items-baseline">
          <span className="text-sm font-bold text-slate-900 uppercase tracking-tight">
            {t('pos.total', 'Total')}
          </span>
          <span className="text-2xl font-black font-mono text-slate-900 tabular-nums">
            ${grandTotal.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="p-4 bg-white border-t border-slate-200 space-y-2.5">
        {/* Secondary Row: Hold, Discount, Notes */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            disabled={cartItems.length === 0}
            onClick={holdCurrentOrder}
            className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            title="Hold Sale (F4)"
          >
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>{t('pos.hold', 'Hold')} (F4)</span>
          </button>

          <button
            type="button"
            onClick={() => setOpenDiscountModal(true)}
            className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all"
            title="Apply Discount (F6)"
          >
            <Tag className="w-3.5 h-3.5 text-blue-600" />
            <span>{t('pos.discount', 'Discount')} (F6)</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNotesInput(prev => !prev)}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl border text-xs font-semibold transition-all ${
              cartNotes
                ? 'border-blue-300 bg-blue-50 text-blue-900'
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
            }`}
            title="Order Notes"
          >
            <FileText className="w-3.5 h-3.5 text-slate-500" />
            <span>{t('pos.notes', 'Notes')}</span>
          </button>
        </div>

        {/* Order Notes Drawer if toggled */}
        {showNotesInput && (
          <div className="p-2 bg-slate-50 border border-slate-200 rounded-xl">
            <textarea
              value={cartNotes}
              onChange={e => setCartNotes(e.target.value)}
              placeholder={t('pos.kitchenNotes', 'Special kitchen or receipt notes...')}
              rows={2}
              className="w-full bg-white text-xs text-slate-800 p-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Primary Checkout Button */}
        <button
          type="button"
          disabled={cartItems.length === 0}
          onClick={() => {
            setActiveRoute('checkout');
            if (onCloseMobile) onCloseMobile();
          }}
          className="w-full flex items-center justify-center gap-2.5 py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-sm font-bold rounded-xl shadow-md disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed transition-all"
        >
          <CreditCard className="w-5 h-5" />
          <span>{t('pos.charge', 'CHARGE')} ${grandTotal.toFixed(2)} (F7)</span>
        </button>
      </div>
    </div>
  );
};
