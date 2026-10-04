import React, { useState, useMemo } from 'react';
import {
  Check,
  Edit2,
  Trash2,
  Plus,
  Search,
  Filter,
  Layers,
  Sparkles,
  AlertTriangle,
  FolderTree,
  DollarSign,
  Utensils,
  ChevronRight,
  ChevronDown,
  Eye,
  PanelLeftClose,
  PanelLeftOpen,
  Tag,
  CheckCircle2,
  Coffee,
  Flame,
  HelpCircle,
  Copy
} from 'lucide-react';
import {
  ExtractedCategory,
  ExtractedProduct,
  ExtractedVariant,
  ExtractedModifierGroup,
  ScannedMenuPage,
  ConflictResolution
} from '../../types/menuScanner.ts';
import { Category, Product } from '../../types/pos.ts';
import { CATEGORY_ICON_MAP } from '../pos/CategoryPanel.tsx';
import { PRODUCT_IMAGE_PRESETS } from '../../utils/productImages.ts';

interface ReviewStepProps {
  categories: ExtractedCategory[];
  products: ExtractedProduct[];
  pages: ScannedMenuPage[];
  existingCategories: Category[];
  existingProducts: Product[];
  onUpdateCategory: (updated: ExtractedCategory) => void;
  onAddCategory: (newCategory: ExtractedCategory) => void;
  onDeleteCategory: (categoryId: string) => void;
  onUpdateProduct: (updated: ExtractedProduct) => void;
  onAddProduct: (newProduct: ExtractedProduct) => void;
  onDeleteProduct: (productId: string) => void;
  onBulkSelectProducts: (selected: boolean, categoryName?: string) => void;
  onBulkSetResolution: (resolution: ConflictResolution) => void;
  onCommitImport: () => void;
  isImporting: boolean;
  currencySymbol: string;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  categories,
  products,
  pages,
  existingCategories,
  existingProducts,
  onUpdateCategory,
  onAddCategory,
  onDeleteCategory,
  onUpdateProduct,
  onAddProduct,
  onDeleteProduct,
  onBulkSelectProducts,
  onBulkSetResolution,
  onCommitImport,
  isImporting,
  currencySymbol
}) => {
  const [activeTab, setActiveTab] = useState<'products' | 'categories'>('products');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showImagePanel, setShowImagePanel] = useState<boolean>(true);
  const [selectedPageIdx, setSelectedPageIdx] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  // Editing state for modals/drawers
  const [editingProduct, setEditingProduct] = useState<ExtractedProduct | null>(null);
  const [editingCategory, setEditingCategory] = useState<ExtractedCategory | null>(null);
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState<boolean>(false);
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState<boolean>(false);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (selectedCategoryFilter !== 'all' && p.categoryName.toLowerCase() !== selectedCategoryFilter.toLowerCase()) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.categoryName?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, selectedCategoryFilter, searchTerm]);

  // Counts
  const selectedProductsCount = useMemo(() => products.filter(p => p.selected && p.resolution !== 'skip').length, [products]);
  const selectedCategoriesCount = useMemo(() => categories.filter(c => c.selected && c.resolution !== 'skip').length, [categories]);
  const conflictedProductsCount = useMemo(() => products.filter(p => p.conflictType !== 'none').length, [products]);

  // Total catalog value
  const totalCatalogValue = useMemo(() => {
    return products
      .filter(p => p.selected && p.resolution !== 'skip')
      .reduce((sum, p) => sum + (p.price || 0), 0);
  }, [products]);

  return (
    <div className="flex flex-col h-full bg-slate-100 overflow-hidden">
      {/* Top Banner with Stats & Actions */}
      <div className="bg-white border-b border-slate-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-xs">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-600" />
              Menu Review & Import Studio
            </h2>
            <p className="text-xs text-slate-500">
              Review, edit, and assign categories before committing to the live database
            </p>
          </div>

          <div className="h-8 w-px bg-slate-200 hidden md:block" />

          {/* Quick Metrics Badges */}
          <div className="hidden lg:flex items-center gap-3 text-xs">
            <div className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-semibold">
              {selectedProductsCount} Products Ready
            </div>
            <div className="px-2.5 py-1 rounded-lg bg-purple-50 border border-purple-200 text-purple-700 font-semibold">
              {selectedCategoriesCount} Categories Ready
            </div>
            {conflictedProductsCount > 0 && (
              <div className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                {conflictedProductsCount} Existing Matches
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Toggle Scanned Image Viewer Button */}
          {pages.length > 0 && (
            <button
              type="button"
              onClick={() => setShowImagePanel(prev => !prev)}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium border border-slate-300 flex items-center gap-1.5 transition-colors"
            >
              {showImagePanel ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              {showImagePanel ? 'Hide Scanned Menu' : 'View Scanned Menu'}
            </button>
          )}

          {/* Final Commit Import Button */}
          <button
            type="button"
            onClick={onCommitImport}
            disabled={selectedProductsCount === 0 || isImporting}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold shadow-md flex items-center gap-2 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            {isImporting ? 'Importing...' : `Import ${selectedProductsCount} Items to Database`}
          </button>
        </div>
      </div>

      {/* Main Content Workspace (Split Layout) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Original Scanned Image Viewer (Collapsible) */}
        {showImagePanel && pages.length > 0 && (
          <div className="w-80 md:w-96 lg:w-[420px] bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 text-white select-none">
            {/* Image Viewer Header */}
            <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">
                Original Scanned Menu ({pages.length} pages)
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoomLevel(z => Math.max(0.75, z - 0.25))}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  -
                </button>
                <span className="text-[10px] text-slate-400 font-mono">{Math.round(zoomLevel * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoomLevel(z => Math.min(2.5, z + 0.25))}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  +
                </button>
              </div>
            </div>

            {/* Main Image Display with Pan & Zoom */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-950">
              <div
                style={{ transform: `scale(${zoomLevel}) rotate(${pages[selectedPageIdx]?.rotation || 0}deg)` }}
                className="transition-transform duration-150 origin-center max-w-full"
              >
                <img
                  src={pages[selectedPageIdx]?.dataUrl}
                  alt={`Scanned Menu Page ${selectedPageIdx + 1}`}
                  className="rounded-lg shadow-2xl border border-slate-700 max-h-[75vh] object-contain"
                />
              </div>
            </div>

            {/* Page Switcher Footer */}
            {pages.length > 1 && (
              <div className="p-2 bg-slate-950 border-t border-slate-800 flex items-center justify-center gap-2 overflow-x-auto">
                {pages.map((p, idx) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPageIdx(idx)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      selectedPageIdx === idx
                        ? 'bg-blue-600 text-white font-bold'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Page {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Right Side: Data Review & Editor Studio */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50 overflow-hidden">
          {/* Subheader Navigation & Search Controls */}
          <div className="bg-white border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            {/* View Tabs */}
            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('products')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'products'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Products ({products.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('categories')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'categories'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Categories ({categories.length})
              </button>
            </div>

            {/* Category Filter & Search Bar */}
            {activeTab === 'products' && (
              <div className="flex items-center gap-3 flex-1 max-w-xl">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search extracted products..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <select
                  value={selectedCategoryFilter}
                  onChange={e => setSelectedCategoryFilter(e.target.value)}
                  className="py-1.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
                >
                  <option value="all">All Categories ({products.length})</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.name}>
                      {c.name} ({products.filter(p => p.categoryName.toLowerCase() === c.name.toLowerCase()).length})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setIsAddProductModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold flex items-center gap-1 border border-blue-200 transition-colors shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Product
                </button>
              </div>
            )}

            {activeTab === 'categories' && (
              <button
                type="button"
                onClick={() => setIsAddCategoryModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold flex items-center gap-1 border border-blue-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Category
              </button>
            )}
          </div>

          {/* Bulk Selection Bar (Products Tab) */}
          {activeTab === 'products' && (
            <div className="bg-slate-100 border-b border-slate-200 px-6 py-2 flex items-center justify-between text-xs text-slate-600">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onBulkSelectProducts(true, selectedCategoryFilter !== 'all' ? selectedCategoryFilter : undefined)}
                  className="font-medium text-blue-600 hover:underline"
                >
                  Select All Filtered
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => onBulkSelectProducts(false, selectedCategoryFilter !== 'all' ? selectedCategoryFilter : undefined)}
                  className="font-medium text-slate-500 hover:underline"
                >
                  Deselect All
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-500">Bulk Conflicts:</span>
                <button
                  type="button"
                  onClick={() => onBulkSetResolution('update_existing')}
                  className="px-2 py-0.5 rounded bg-white hover:bg-slate-200 border border-slate-300 font-medium text-slate-700"
                >
                  Set all matches to "Update"
                </button>
                <button
                  type="button"
                  onClick={() => onBulkSetResolution('create_new')}
                  className="px-2 py-0.5 rounded bg-white hover:bg-slate-200 border border-slate-300 font-medium text-slate-700"
                >
                  Set all to "Create New"
                </button>
              </div>
            </div>
          )}

          {/* Tab 1: Products Table & Cards View */}
          {activeTab === 'products' && (
            <div className="flex-1 overflow-y-auto p-6">
              {filteredProducts.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
                  <Utensils className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <h4 className="text-base font-semibold text-slate-800">No products match your filter</h4>
                  <p className="text-xs text-slate-500 mt-1">Try resetting your search query or category filter</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredProducts.map(product => {
                    const hasVariants = product.variants && product.variants.length > 0;
                    const hasModifiers = product.modifiers && product.modifiers.length > 0;

                    return (
                      <div
                        key={product.id || product.tempId}
                        className={`bg-white rounded-xl border transition-all p-4 shadow-xs ${
                          !product.selected
                            ? 'opacity-60 border-slate-200 bg-slate-50/50'
                            : product.conflictType !== 'none'
                            ? 'border-amber-200 hover:border-amber-300'
                            : 'border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                          {/* Left Checkbox & Product Details */}
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={product.selected}
                              onChange={e => onUpdateProduct({ ...product, selected: e.target.checked })}
                              className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 mt-1 shrink-0 cursor-pointer"
                            />

                            {/* Product Thumbnail / Placeholder */}
                            {product.imageUrl ? (
                              <img
                                src={product.imageUrl}
                                alt={product.name}
                                className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0"
                              />
                            ) : (
                              <div
                                style={{ backgroundColor: product.color || '#2563EB' }}
                                className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold shrink-0 shadow-xs"
                              >
                                {product.name.charAt(0).toUpperCase()}
                              </div>
                            )}

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-bold text-slate-900 leading-tight">
                                  {product.name}
                                </h4>
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold border border-slate-200">
                                  {product.categoryName}
                                </span>

                                {/* Dietary Badges */}
                                {product.isSpicy && (
                                  <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold border border-rose-200">
                                    🌶️ Spicy
                                  </span>
                                )}
                                {product.isVegetarian && (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                                    🌱 Veg
                                  </span>
                                )}
                                {product.isGlutenFree && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">
                                    🌾 GF
                                  </span>
                                )}
                              </div>

                              {product.description && (
                                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                                  {product.description}
                                </p>
                              )}

                              {/* Variants & Modifiers indicators */}
                              {(hasVariants || hasModifiers) && (
                                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-600">
                                  {hasVariants && (
                                    <span className="font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                                      {product.variants.length} Sizes/Variants (
                                      {product.variants.map(v => `${v.name}: ${currencySymbol}${v.price}`).join(', ')}
                                      )
                                    </span>
                                  )}
                                  {hasModifiers && (
                                    <span className="font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded">
                                      {product.modifiers.length} Modifier Group(s)
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right: Price, Conflict Resolution & Actions */}
                          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                            {/* Price Badge */}
                            <div className="text-right">
                              <span className="text-base font-extrabold text-slate-900 font-mono">
                                {currencySymbol}{product.price.toFixed(2)}
                              </span>
                              <div className="text-[10px] text-slate-400">
                                SKU: {product.sku}
                              </div>
                            </div>

                            {/* Conflict Resolution Selector */}
                            {product.conflictType !== 'none' && (
                              <div className="flex flex-col items-end">
                                <span className="text-[10px] text-amber-700 font-semibold flex items-center gap-1 mb-1">
                                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                                  Match Found
                                </span>
                                <select
                                  value={product.resolution}
                                  onChange={e =>
                                    onUpdateProduct({
                                      ...product,
                                      resolution: e.target.value as ConflictResolution
                                    })
                                  }
                                  className="text-xs py-1 px-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 font-medium focus:ring-1 focus:ring-amber-500"
                                >
                                  <option value="update_existing">Update Existing</option>
                                  <option value="create_new">Create New Copy</option>
                                  <option value="skip">Skip / Do Not Import</option>
                                </select>
                              </div>
                            )}

                            {/* Edit & Delete Buttons */}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setEditingProduct(product)}
                                className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-blue-600 transition-colors"
                                title="Edit Product"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteProduct(product.id || product.tempId)}
                                className="p-2 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"
                                title="Delete Product"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Categories View */}
          {activeTab === 'categories' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categories.map(category => {
                  const IconComp = CATEGORY_ICON_MAP[category.iconName] || CATEGORY_ICON_MAP.Package;
                  const count = products.filter(
                    p => p.categoryName.toLowerCase() === category.name.toLowerCase() && p.selected
                  ).length;

                  return (
                    <div
                      key={category.id || category.tempId}
                      className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-3">
                            <div
                              style={{ backgroundColor: category.color }}
                              className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-xs"
                            >
                              <IconComp className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-900 text-sm">{category.name}</h4>
                              <span className="text-xs text-slate-500 font-medium">
                                {count} assigned {count === 1 ? 'product' : 'products'}
                              </span>
                            </div>
                          </div>

                          <input
                            type="checkbox"
                            checked={category.selected}
                            onChange={e => onUpdateCategory({ ...category, selected: e.target.checked })}
                            className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                          />
                        </div>

                        {category.description && (
                          <p className="text-xs text-slate-500 mb-3">{category.description}</p>
                        )}

                        {category.conflictExistingId && (
                          <div className="mt-2 p-2 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
                            <span className="font-semibold">Matches existing AuraPOS category</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-3">
                        <span className="text-[11px] text-slate-400">
                          {category.autoPrintKitchen ? '🍳 Kitchen routing enabled' : '🧾 Receipt only'}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingCategory(category)}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-blue-600"
                            title="Edit Category"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteCategory(category.id || category.tempId)}
                            className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                            title="Delete Category"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Product Drawer / Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">Edit Scanned Product</h3>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Product Name</label>
                <input
                  type="text"
                  value={editingProduct.name}
                  onChange={e => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={editingProduct.categoryName}
                    onChange={e => {
                      const cat = categories.find(c => c.name === e.target.value);
                      setEditingProduct({
                        ...editingProduct,
                        categoryName: e.target.value,
                        categoryId: cat?.id
                      });
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    {categories.map(c => (
                      <option key={c.id || c.tempId} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Price ({currencySymbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingProduct.price}
                    onChange={e => setEditingProduct({ ...editingProduct, price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={editingProduct.description}
                  onChange={e => setEditingProduct({ ...editingProduct, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingProduct.cost}
                    onChange={e => setEditingProduct({ ...editingProduct, cost: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">SKU</label>
                  <input
                    type="text"
                    value={editingProduct.sku}
                    onChange={e => setEditingProduct({ ...editingProduct, sku: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Barcode</label>
                  <input
                    type="text"
                    value={editingProduct.barcode}
                    onChange={e => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              {/* Dietary Flags */}
              <div className="flex items-center gap-4 pt-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingProduct.isSpicy}
                    onChange={e => setEditingProduct({ ...editingProduct, isSpicy: e.target.checked })}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  🌶️ Spicy
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingProduct.isVegetarian}
                    onChange={e => setEditingProduct({ ...editingProduct, isVegetarian: e.target.checked })}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  🌱 Vegetarian
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingProduct.isGlutenFree}
                    onChange={e => setEditingProduct({ ...editingProduct, isGlutenFree: e.target.checked })}
                    className="rounded text-amber-600 focus:ring-amber-500"
                  />
                  🌾 Gluten-Free
                </label>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateProduct(editingProduct);
                  setEditingProduct(null);
                }}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Category Modal */}
      {editingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">Edit Category</h3>
              <button
                type="button"
                onClick={() => setEditingCategory(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category Name</label>
                <input
                  type="text"
                  value={editingCategory.name}
                  onChange={e => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  value={editingCategory.description || ''}
                  onChange={e => setEditingCategory({ ...editingCategory, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingCategory.autoPrintKitchen}
                    onChange={e => setEditingCategory({ ...editingCategory, autoPrintKitchen: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  Auto-print Kitchen Orders
                </label>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingCategory(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateCategory(editingCategory);
                  setEditingCategory(null);
                }}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs"
              >
                Save Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Category Modal */}
      {isAddCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">Add New Category</h3>
              <button
                type="button"
                onClick={() => setIsAddCategoryModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={e => {
                e.preventDefault();
                const form = e.target as any;
                const name = form.catName.value.trim();
                if (!name) return;

                const newCat: ExtractedCategory = {
                  id: `cat_new_${Date.now()}`,
                  tempId: `temp_cat_${Date.now()}`,
                  name,
                  description: form.catDesc.value.trim(),
                  color: '#2563EB',
                  iconName: 'Package',
                  sortOrder: categories.length + 1,
                  active: true,
                  autoPrintKitchen: true,
                  productCount: 0,
                  selected: true,
                  resolution: 'create_new'
                };
                onAddCategory(newCat);
                setIsAddCategoryModalOpen(false);
              }}
              className="p-6 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category Name *</label>
                <input
                  name="catName"
                  required
                  placeholder="e.g. Specialty Drinks"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <input
                  name="catDesc"
                  placeholder="Optional subtitle..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div className="px-0 py-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddCategoryModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs"
                >
                  Add Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
