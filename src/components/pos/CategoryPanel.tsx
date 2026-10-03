import React, { useMemo } from 'react';
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
  ShoppingBag,
  Package,
  Pizza,
  Salad,
  IceCream,
  Beer,
  Wine,
  Apple,
  Sparkles,
  Tag,
  Layers,
  Flame,
  CupSoda
} from 'lucide-react';

interface CategoryPanelProps {
  selectedCategoryId: string;
  onSelectCategory: (categoryId: string) => void;
}

export const CATEGORY_ICON_MAP: Record<string, React.ElementType> = {
  LayoutGrid,
  Star,
  Coffee,
  Leaf,
  Croissant,
  Utensils,
  GlassWater,
  Cake,
  ShoppingBag,
  Package,
  Pizza,
  Salad,
  IceCream,
  Beer,
  Wine,
  Apple,
  Sparkles,
  Tag,
  Layers,
  Flame,
  CupSoda
};

export const CategoryPanel: React.FC<CategoryPanelProps> = ({
  selectedCategoryId,
  onSelectCategory,
}) => {
  const { categories, products, t, translateCategoryName } = usePOS();

  // Load only active categories ordered by sort_order (Requirement 10 & 14)
  const activeCategories = useMemo(() => {
    return categories
      .filter(c => c.active)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [categories]);

  const hasFavorites = useMemo(() => {
    return products.some(p => p.active && p.isFavorite);
  }, [products]);

  const getProductCount = (catId: string) => {
    if (catId === 'cat_all') return products.filter(p => p.active).length;
    if (catId === 'cat_fav') return products.filter(p => p.active && p.isFavorite).length;
    return products.filter(p => p.active && p.categoryId === catId).length;
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

        {/* 1. All Items Category Button (Requirement 14 & 15) */}
        <button
          onClick={() => onSelectCategory('cat_all')}
          className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all group ${
            selectedCategoryId === 'cat_all'
              ? 'bg-blue-600 text-white font-semibold shadow-sm'
              : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                selectedCategoryId === 'cat_all'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </div>
            <span className="text-xs truncate">{t('pos.allCategories', 'All Items')}</span>
          </div>

          <span
            className={`text-[11px] font-mono px-1.5 py-0.5 rounded-md shrink-0 ${
              selectedCategoryId === 'cat_all' ? 'bg-blue-700 text-blue-100' : 'text-slate-400'
            }`}
          >
            {getProductCount('cat_all')}
          </span>
        </button>

        {/* Optional Favorites Button */}
        {hasFavorites && (
          <button
            onClick={() => onSelectCategory('cat_fav')}
            className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all group ${
              selectedCategoryId === 'cat_fav'
                ? 'bg-amber-500 text-white font-semibold shadow-sm'
                : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  selectedCategoryId === 'cat_fav'
                    ? 'bg-white/20 text-white'
                    : 'bg-amber-50 text-amber-600 group-hover:bg-amber-100'
                }`}
              >
                <Star className="w-4 h-4 fill-current" />
              </div>
              <span className="text-xs truncate">{t('pos.favorites', 'Favorites')}</span>
            </div>

            <span
              className={`text-[11px] font-mono px-1.5 py-0.5 rounded-md shrink-0 ${
                selectedCategoryId === 'cat_fav' ? 'bg-amber-600 text-amber-100' : 'text-slate-400'
              }`}
            >
              {getProductCount('cat_fav')}
            </span>
          </button>
        )}

        {/* 2. Real Database Active Categories */}
        {activeCategories.map(cat => {
          const Icon = CATEGORY_ICON_MAP[cat.iconName] || CATEGORY_ICON_MAP.Package;
          const isSelected = selectedCategoryId === cat.id;
          const count = getProductCount(cat.id);
          const displayName = translateCategoryName(cat.id, cat.name);

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
                {cat.imageUrl ? (
                  <img
                    src={cat.imageUrl}
                    alt={displayName}
                    className="w-7 h-7 rounded-lg object-cover shrink-0 border border-slate-200"
                  />
                ) : (
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
                    }`}
                    style={!isSelected && cat.color ? { color: cat.color, backgroundColor: `${cat.color}15` } : {}}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                )}
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

        {activeCategories.length === 0 && (
          <div className="py-6 px-2 text-center text-slate-400 text-xs">
            {t('categories.emptyInPos', 'No custom categories')}
          </div>
        )}
      </div>

      {/* Mobile Horizontal Scrolling Category Pills */}
      <div className="md:hidden flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200 overflow-x-auto shrink-0 select-none scrollbar-none">
        {/* All Button */}
        <button
          onClick={() => onSelectCategory('cat_all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 transition-all ${
            selectedCategoryId === 'cat_all'
              ? 'bg-blue-600 text-white font-semibold shadow-xs'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>{t('pos.allCategories', 'All')}</span>
          <span
            className={`text-[10px] font-mono px-1 py-0.2 rounded ${
              selectedCategoryId === 'cat_all' ? 'bg-blue-700 text-blue-100' : 'bg-slate-200/80 text-slate-500'
            }`}
          >
            {getProductCount('cat_all')}
          </span>
        </button>

        {/* Favorites Button */}
        {hasFavorites && (
          <button
            onClick={() => onSelectCategory('cat_fav')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 transition-all ${
              selectedCategoryId === 'cat_fav'
                ? 'bg-amber-500 text-white font-semibold shadow-xs'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            <Star className="w-3.5 h-3.5 fill-current" />
            <span>{t('pos.favorites', 'Favorites')}</span>
            <span
              className={`text-[10px] font-mono px-1 py-0.2 rounded ${
                selectedCategoryId === 'cat_fav' ? 'bg-amber-600 text-amber-100' : 'bg-amber-200/80 text-amber-800'
              }`}
            >
              {getProductCount('cat_fav')}
            </span>
          </button>
        )}

        {/* Active categories */}
        {activeCategories.map(cat => {
          const Icon = CATEGORY_ICON_MAP[cat.iconName] || CATEGORY_ICON_MAP.Package;
          const isSelected = selectedCategoryId === cat.id;
          const count = getProductCount(cat.id);
          const displayName = translateCategoryName(cat.id, cat.name);

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
              {cat.imageUrl ? (
                <img src={cat.imageUrl} alt={displayName} className="w-3.5 h-3.5 rounded object-cover" />
              ) : (
                <Icon className="w-3.5 h-3.5" style={!isSelected && cat.color ? { color: cat.color } : {}} />
              )}
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
