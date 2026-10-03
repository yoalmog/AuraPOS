import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext.tsx';
import { CategoryPanel } from './CategoryPanel.tsx';
import { ProductGrid } from './ProductGrid.tsx';
import { CartPanel } from './CartPanel.tsx';
import { CustomerSelectorModal } from './CustomerSelectorModal.tsx';
import { DiscountModal } from './DiscountModal.tsx';
import { HeldOrdersModal } from './HeldOrdersModal.tsx';
import { ShoppingBag, ArrowRight } from 'lucide-react';

interface POSScreenProps {
  searchTerm: string;
}

export const POSScreen: React.FC<POSScreenProps> = ({ searchTerm }) => {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('cat_all');
  const [isMobileCartOpen, setIsMobileCartOpen] = useState<boolean>(false);
  const { cartItems, grandTotal, t } = usePOS();

  const totalItemCount = cartItems.reduce((acc, i) => acc + i.quantity, 0);

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
      {/* 1. Category Panel (Horizontal pills on mobile, vertical sidebar on desktop) */}
      <CategoryPanel
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={setSelectedCategoryId}
      />

      {/* 2. Product Grid (Center) */}
      <ProductGrid
        selectedCategoryId={selectedCategoryId}
        searchTerm={searchTerm}
      />

      {/* 3. Cart Panel (Right sidebar on desktop, full overlay modal on mobile) */}
      <CartPanel
        isOpenOnMobile={isMobileCartOpen}
        onCloseMobile={() => setIsMobileCartOpen(false)}
      />

      {/* 4. Mobile Floating Cart Summary Button (< lg) */}
      {cartItems.length > 0 && !isMobileCartOpen && (
        <div className="lg:hidden fixed bottom-4 inset-x-4 z-30">
          <button
            type="button"
            onClick={() => setIsMobileCartOpen(true)}
            className="w-full flex items-center justify-between px-4 py-3 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white rounded-2xl shadow-xl border border-blue-500/40 transition-all"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-white/20 flex items-center justify-center text-xs font-bold font-mono">
                {totalItemCount}
              </div>
              <span className="text-sm font-bold">{t('pos.viewOrder', 'View Current Order')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-black font-mono">${grandTotal.toFixed(2)}</span>
              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Reusable POS Modals */}
      <CustomerSelectorModal />
      <DiscountModal />
      <HeldOrdersModal />
    </div>
  );
};
