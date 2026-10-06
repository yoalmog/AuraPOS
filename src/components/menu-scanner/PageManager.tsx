import React, { useState } from 'react';
import {
  RotateCw,
  RotateCcw,
  Trash2,
  MoveLeft,
  MoveRight,
  Eye,
  Plus,
  Camera,
  Upload,
  FileText,
  Sparkles,
  CheckCircle2,
  Undo2
} from 'lucide-react';
import { ScannedMenuPage } from '../../types/menuScanner.ts';

interface PageManagerProps {
  pages: ScannedMenuPage[];
  onRotatePageRight: (id: string) => void;
  onRotatePageLeft: (id: string) => void;
  onResetPageOrientation: (id: string) => void;
  onTogglePageTab: (id: string, tab: 'corrected' | 'original') => void;
  onRemovePage: (id: string) => void;
  onMovePage: (index: number, direction: 'left' | 'right') => void;
  onPreviewPage: (page: ScannedMenuPage) => void;
  onOpenLiveCamera: () => void;
  onTriggerFileUpload: () => void;
  onOpenNativeGallery?: () => void;
  onImportPdf?: () => void;
  isNativeAndroid?: boolean;
}

export const PageManager: React.FC<PageManagerProps> = ({
  pages,
  onRotatePageRight,
  onRotatePageLeft,
  onResetPageOrientation,
  onTogglePageTab,
  onRemovePage,
  onMovePage,
  onPreviewPage,
  onOpenLiveCamera,
  onTriggerFileUpload,
  onOpenNativeGallery,
  onImportPdf,
  isNativeAndroid
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-900 text-base">
            Páginas del Menú ({pages.length})
          </h3>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {isNativeAndroid ? 'OCR Nativo Android Listo' : 'OCR Local en Español Listo'}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onOpenLiveCamera}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            Cámara
          </button>
          {onOpenNativeGallery && (
            <button
              type="button"
              onClick={onOpenNativeGallery}
              className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold flex items-center gap-1.5 border border-indigo-200 transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Galería
            </button>
          )}
          {onImportPdf && (
            <button
              type="button"
              onClick={onImportPdf}
              className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold flex items-center gap-1.5 border border-amber-200 transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              Menú PDF
            </button>
          )}
          <label
            htmlFor="menu-global-file-input"
            onClick={onTriggerFileUpload}
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1.5 border border-slate-300 transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Subir Foto
          </label>
        </div>
      </div>

      {pages.length === 0 ? (
        <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 sm:p-12 text-center bg-slate-50/50 hover:bg-slate-50 transition-colors">
          <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-4 shadow-xs">
            <FileText className="w-8 h-8" />
          </div>
          <h4 className="text-base font-semibold text-slate-900 mb-1">Ninguna Página Agregada Aún</h4>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
            Tome fotos del menú impreso (en español o cualquier orientación) o suba archivos de imagen / PDF.
            El sistema detectará automáticamente la orientación y corregirá la inclinación.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onOpenLiveCamera}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              Abrir Cámara
            </button>
            <label
              htmlFor="menu-global-file-input"
              onClick={onTriggerFileUpload}
              className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-sm font-medium border border-slate-300 shadow-xs transition-all flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Subir Fotos / PDF
            </label>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {pages.map((page, idx) => {
            const isShowingCorrected = page.activeDisplayTab !== 'original';
            const displayUrl = isShowingCorrected
              ? page.correctedDataUrl || page.dataUrl
              : page.originalDataUrl || page.dataUrl;

            return (
              <div
                key={page.id}
                className="group relative bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col"
              >
                {/* Header with Page Number and Auto-Orientation Badge */}
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">Página {idx + 1}</span>
                  {page.autoRotationApplied !== undefined && page.autoRotationApplied !== 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <Sparkles className="w-3 h-3 text-emerald-600" />
                      Auto {page.autoRotationApplied}°
                    </span>
                  )}
                </div>

                {/* Tab Switcher: "Original" vs "Corrected for scanning" (Requirement 3) */}
                <div className="px-2 pt-2 bg-slate-50/50 flex items-center justify-center">
                  <div className="inline-flex rounded-lg bg-slate-200 p-0.5 text-[11px] w-full">
                    <button
                      type="button"
                      onClick={() => onTogglePageTab(page.id, 'corrected')}
                      className={`flex-1 py-1 rounded-md font-medium text-center transition-colors cursor-pointer ${
                        isShowingCorrected
                          ? 'bg-blue-600 text-white shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Corregida ({page.rotation || 0}°)
                    </button>
                    <button
                      type="button"
                      onClick={() => onTogglePageTab(page.id, 'original')}
                      className={`flex-1 py-1 rounded-md font-medium text-center transition-colors cursor-pointer ${
                        !isShowingCorrected
                          ? 'bg-slate-700 text-white shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Original
                    </button>
                  </div>
                </div>

                {/* Image Preview Canvas */}
                <div
                  className="relative h-52 bg-slate-100 flex items-center justify-center overflow-hidden cursor-pointer"
                  onClick={() => onPreviewPage(page)}
                >
                  <img
                    src={displayUrl}
                    alt={page.name}
                    className="w-full h-full object-contain transition-transform duration-200 bg-slate-900/5"
                  />

                  <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white">
                    <Eye className="w-5 h-5 drop-shadow" />
                    <span className="text-xs font-medium drop-shadow">Inspeccionar</span>
                  </div>
                </div>

                {/* Manual Orientation Adjustment Toolbar (Requirement 3: Rotate Left, Rotate Right, Reset) */}
                <div className="p-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-1 text-slate-700">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRotatePageLeft(page.id)}
                      className="px-2 py-1 rounded hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1 text-[11px] font-semibold border border-slate-300/80 bg-white shadow-2xs"
                      title="Girar 90° a la Izquierda"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
                      -90°
                    </button>
                    <button
                      type="button"
                      onClick={() => onRotatePageRight(page.id)}
                      className="px-2 py-1 rounded hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1 text-[11px] font-semibold border border-slate-300/80 bg-white shadow-2xs"
                      title="Girar 90° a la Derecha"
                    >
                      <RotateCw className="w-3.5 h-3.5 text-blue-600" />
                      +90°
                    </button>
                    <button
                      type="button"
                      onClick={() => onResetPageOrientation(page.id)}
                      className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
                      title="Restablecer Orientación Original"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onMovePage(idx, 'left')}
                      className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
                      title="Mover a la izquierda"
                    >
                      <MoveLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === pages.length - 1}
                      onClick={() => onMovePage(idx, 'right')}
                      className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
                      title="Mover a la derecha"
                    >
                      <MoveRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemovePage(page.id)}
                      className="p-1.5 rounded hover:bg-rose-100 text-rose-600 transition-colors"
                      title="Eliminar página"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Add Another Page Card */}
          <div className="h-64 rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-400 bg-slate-50/50 hover:bg-blue-50/30 flex flex-col items-center justify-center p-4 text-center transition-all">
            <div className="w-10 h-10 rounded-full bg-white shadow-xs border border-slate-200 flex items-center justify-center text-slate-600 mb-2">
              <Plus className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-xs font-semibold text-slate-800 mb-1">Agregar Otra Página</span>
            <span className="text-[11px] text-slate-500 mb-2">Hasta 5 páginas simultáneas</span>
            <div className="flex items-center gap-1.5 mt-2">
              <button
                type="button"
                onClick={onOpenLiveCamera}
                className="p-1.5 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-medium transition-colors cursor-pointer"
                title="Usar Cámara"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
              <label
                htmlFor="menu-global-file-input"
                onClick={onTriggerFileUpload}
                className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                title="Subir Foto"
              >
                <Upload className="w-3.5 h-3.5" />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
