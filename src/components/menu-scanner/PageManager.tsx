import React from 'react';
import {
  RotateCw,
  Trash2,
  MoveLeft,
  MoveRight,
  Eye,
  Plus,
  Camera,
  Upload,
  FileText
} from 'lucide-react';
import { ScannedMenuPage } from '../../types/menuScanner.ts';

interface PageManagerProps {
  pages: ScannedMenuPage[];
  onRotatePage: (id: string) => void;
  onRemovePage: (id: string) => void;
  onMovePage: (index: number, direction: 'left' | 'right') => void;
  onPreviewPage: (page: ScannedMenuPage) => void;
  onOpenLiveCamera: () => void;
  onTriggerFileUpload: () => void;
}

export const PageManager: React.FC<PageManagerProps> = ({
  pages,
  onRotatePage,
  onRemovePage,
  onMovePage,
  onPreviewPage,
  onOpenLiveCamera,
  onTriggerFileUpload
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-900 text-base">
            Scanned Menu Pages ({pages.length})
          </h3>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium border border-blue-200">
            Multi-page ready
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenLiveCamera}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            Camera
          </button>
          <label
            htmlFor="menu-global-file-input"
            onClick={onTriggerFileUpload}
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1.5 border border-slate-300 transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload File
          </label>
        </div>
      </div>

      {pages.length === 0 ? (
        <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 sm:p-12 text-center bg-slate-50/50 hover:bg-slate-50 transition-colors">
          <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-4 shadow-xs">
            <FileText className="w-8 h-8" />
          </div>
          <h4 className="text-base font-semibold text-slate-900 mb-1">No Menu Pages Added Yet</h4>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
            Capture photos of your printed restaurant menu using your camera, or upload images / PDF files.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onOpenLiveCamera}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              Open Camera
            </button>
            <label
              htmlFor="menu-global-file-input"
              onClick={onTriggerFileUpload}
              className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-sm font-medium border border-slate-300 shadow-xs transition-all flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Upload Photos / PDF
            </label>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {pages.map((page, idx) => (
            <div
              key={page.id}
              className="group relative bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col"
            >
              {/* Image Preview */}
              <div
                className="relative h-48 bg-slate-100 flex items-center justify-center overflow-hidden cursor-pointer"
                onClick={() => onPreviewPage(page)}
              >
                <img
                  src={page.dataUrl}
                  alt={page.name}
                  style={{ transform: `rotate(${page.rotation || 0}deg)` }}
                  className="w-full h-full object-cover transition-transform duration-200"
                />
                <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white">
                  <Eye className="w-5 h-5 drop-shadow" />
                  <span className="text-xs font-medium drop-shadow">Inspect</span>
                </div>

                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-slate-900/80 backdrop-blur-xs text-white text-xs font-semibold">
                  Page {idx + 1}
                </div>
              </div>

              {/* Action Bar */}
              <div className="p-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-1 text-slate-600">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => onMovePage(idx, 'left')}
                    className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
                    title="Move Left"
                  >
                    <MoveLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === pages.length - 1}
                    onClick={() => onMovePage(idx, 'right')}
                    className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
                    title="Move Right"
                  >
                    <MoveRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onRotatePage(page.id)}
                    className="p-1.5 rounded hover:bg-slate-200 text-slate-700 transition-colors"
                    title="Rotate 90°"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemovePage(page.id)}
                    className="p-1.5 rounded hover:bg-rose-100 text-rose-600 transition-colors"
                    title="Remove Page"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Add Another Page Card */}
          <div className="h-56 rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-400 bg-slate-50/50 hover:bg-blue-50/30 flex flex-col items-center justify-center p-4 text-center transition-all">
            <div className="w-10 h-10 rounded-full bg-white shadow-xs border border-slate-200 flex items-center justify-center text-slate-600 mb-2">
              <Plus className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-xs font-semibold text-slate-800 mb-1">Add Another Page</span>
            <div className="flex items-center gap-1.5 mt-2">
              <button
                type="button"
                onClick={onOpenLiveCamera}
                className="p-1.5 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-medium transition-colors cursor-pointer"
                title="Use Camera"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
              <label
                htmlFor="menu-global-file-input"
                onClick={onTriggerFileUpload}
                className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                title="Upload Photo"
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
