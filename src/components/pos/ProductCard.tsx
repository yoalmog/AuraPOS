import React from 'react';
import { Product } from '../../types/pos.ts';
import { usePOS } from '../../context/POSContext.tsx';
import {
  Coffee,
  Leaf,
  Croissant,
  Utensils,
  GlassWater,
  Cake,
  ShoppingBag,
  Layers,
  AlertCircle
} from 'lucide-react';

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
}

const ICON_MAP: Record<string, React.ElementType> = {
  Coffee,
  Leaf,
  Croissant,
  Utensils,
  GlassWater,
  Cake,
  ShoppingBag,
};

export const ProductCard: React.FC<ProductCardProps> = ({ product, onSelect }) => {
  const { settings, t, translateProductName } = usePOS();

  const IconComponent = product.iconName && ICON_MAP[product.iconName] ? ICON_MAP[product.iconName] : Coffee;
  const isOutOfStock = product.trackInventory && product.stock <= 0;
  const isLowStock = product.trackInventory && product.stock > 0 && product.stock <= product.lowStockThreshold;
  const hasVariants = product.variants && product.variants.length > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      disabled={isOutOfStock && !settings.allowNegativeStock}
      className={`group relative flex flex-col justify-between text-left p-3.5 rounded-2xl border transition-all duration-150 h-40 ${
        isOutOfStock && !settings.allowNegativeStock
          ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
          : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-blue-400 hover:shadow-md active:scale-[0.98]'
      }`}
    >
      {/* Top row: Image Thumbnail or Icon & Stock status */}
      <div className="flex items-start justify-between w-full gap-2">
        {product.imageUrl ? (
          <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 shadow-xs border border-slate-200/80 bg-slate-100 transition-transform group-hover:scale-105">
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={e => {
                // Hide broken image and fall back to icon
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
        ) : (
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-xs transition-transform group-hover:scale-105"
            style={{
              backgroundColor: product.color ? `${product.color}15` : '#EFF6FF',
              color: product.color || '#2563EB',
            }}
          >
            <IconComponent className="w-5 h-5" />
          </div>
        )}

        <div className="flex flex-col items-end">
          {hasVariants ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
              <Layers className="w-3 h-3" />
              {product.variants!.length} {t('pos.options', 'options')}
            </span>
          ) : product.trackInventory ? (
            <span
              className={`text-[11px] font-mono px-2 py-0.5 rounded-md leading-tight ${
                isOutOfStock
                  ? 'bg-rose-100 text-rose-700 font-semibold'
                  : isLowStock
                  ? 'bg-amber-100 text-amber-800 font-semibold'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {isOutOfStock ? t('pos.outOfStock', 'Out of stock') : `${product.stock} ${t('pos.inStock', 'in stock')}`}
            </span>
          ) : null}
        </div>
      </div>

      {/* Center / Bottom: Title & Price */}
      <div className="mt-2 w-full">
        <h4 className="text-xs font-semibold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2 leading-snug">
          {translateProductName(product.id, product.name)}
        </h4>

        <div className="mt-1.5 flex items-baseline justify-between">
          <p className="text-base font-bold font-mono text-slate-900 tabular-nums">
            ${product.price.toFixed(2)}
          </p>
          <span className="text-[10px] text-slate-400 font-mono truncate max-w-[80px]">
            {product.sku}
          </span>
        </div>
      </div>

      {/* Low stock warning marker */}
      {isLowStock && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full ring-2 ring-white" />
      )}
    </button>
  );
};
