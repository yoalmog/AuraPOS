import React from 'react';
import { usePOS } from '../../context/POSContext.tsx';
import {
  LayoutGrid,
  Star,
  Coffee,
  Leaf,
  Croissant,
  Utensils,
  GlassWater,
  Cake,
  ShoppingBag
} from 'lucide-react';

interface CategoryPanelProps {
  selectedCategoryId: string;
  onSelectCategory: (categoryId: string) => void;
}

const CATEGORY_ICON_MAP: Record<string, React.ElementType> = {
  LayoutGrid,
  Star,
  Coffee,
  Leaf,
  Croissant,
  Utensils,
  GlassWater,
  Cake,
  ShoppingBag,
};

export const CategoryPanel: React.FC<CategoryPanelProps> = ({
  selectedCategoryId,
  onSelectCategory,
}) => {
  const { categories, products, t, translateCategoryName } = usePOS();

  const getProductCount = (catId: string) => {
    if (catId === 'cat_all') return products.length;
    if (catId === 'cat_fav') return products.filter(p => p.isFavorite).length;
    return products.filter(p => p.categoryId === catId).length;
  };

  const getCategoryDisplayName = (cat: { id: string; name: string }) => {
    return translateCategoryName(cat.id, cat.name);
  };

  return (
    <>
      {/* Desktop / Tablet Vertical Category Sidebar */}
      <div className="hidden md:flex w-44 lg:w-48 bg-white border-r border-slate-200 p-2.5 flex-col gap-1.5 overflow-y-auto shrink-0 select-none">
        <div className="px-2.5 py-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {t('pos.categories', 'Categories')}
          </span>
        </div>

        {categories.map(cat => {
          const Icon = CATEGORY_ICON_MAP[cat.iconName] || LayoutGrid;
          const isSelected = selectedCategoryId === cat.id;
          const count = getProductCount(cat.id);
          const displayName = getCategoryDisplayName(cat);

          return (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id)}
              className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all group ${
                isSelected
                  ? 'bg-blue-600 text-white font-semibold shadow-sm'
                  : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
                  }`}
                  style={!isSelected && cat.color ? { color: cat.color } : {}}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-xs truncate">{displayName}</span>
              </div>

              <span
                className={`text-[11px] font-mono px-1.5 py-0.5 rounded-md shrink-0 ${
                  isSelected ? 'bg-blue-700 text-blue-100' : 'text-slate-400'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobile Horizontal Scrolling Category Pills */}
      <div className="md:hidden flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200 overflow-x-auto shrink-0 select-none scrollbar-none">
        {categories.map(cat => {
          const Icon = CATEGORY_ICON_MAP[cat.iconName] || LayoutGrid;
          const isSelected = selectedCategoryId === cat.id;
          const count = getProductCount(cat.id);
          const displayName = getCategoryDisplayName(cat);

          return (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 transition-all ${
                isSelected
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{displayName}</span>
              <span
                className={`text-[10px] font-mono px-1 py-0.2 rounded ${
                  isSelected ? 'bg-blue-700 text-blue-100' : 'bg-slate-200/80 text-slate-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
};
