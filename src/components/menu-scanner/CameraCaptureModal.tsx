import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  X,
  RotateCcw,
  Check,
  Zap,
  ZapOff,
  SwitchCamera,
  Layers,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { ScannedMenuPage } from '../../types/menuScanner.ts';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPagesCaptured: (pages: ScannedMenuPage[]) => void;
  existingPagesCount: number;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onPagesCaptured,
  existingPagesCount
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedPages, setCapturedPages] = useState<ScannedMenuPage[]>([]);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isFlashEffect, setIsFlashEffect] = useState<boolean>(false);

  // Start Camera
  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    try {
      setCameraError(null);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 2560 },
          height: { ideal: 1440 }
        },
        audio: false
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.play().catch(console.error);
      }

      // Check torch capability
      const videoTrack = newStream.getVideoTracks()[0];
      const capabilities = (videoTrack?.getCapabilities?.() || {}) as any;
      setHasTorch(!!capabilities.torch);
      setIsTorchOn(false);
    } catch (err: any) {
      console.warn('Camera access failed:', err);
      setCameraError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Please allow camera access in your browser or device settings.'
          : 'Unable to access device camera. You can also upload menu photos or PDF files directly.'
      );
    }
  }, [stream]);

  useEffect(() => {
    if (isOpen) {
      startCamera(facingMode);
    } else {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        setStream(null);
      }
      setCapturedPages([]);
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [isOpen]);

  // Toggle Torch
  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    try {
      const nextTorch = !isTorchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextTorch }]
      });
      setIsTorchOn(nextTorch);
    } catch (e) {
      console.error('Torch toggle failed:', e);
    }
  };

  // Flip Camera
  const toggleCameraFacing = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  // Capture Single Photo
  const handleSnap = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    const width = video.videoWidth || 1920;
    const height = video.videoHeight || 1080;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Trigger visual shutter flash
    setIsFlashEffect(true);
    setTimeout(() => setIsFlashEffect(false), 200);

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    const newPage: ScannedMenuPage = {
      id: `page_${Date.now()}_${capturedPages.length}`,
      name: `Menu Page ${existingPagesCount + capturedPages.length + 1}`,
      dataUrl,
      mimeType: 'image/jpeg',
      rotation: 0,
      timestamp: new Date().toISOString(),
      fileSize: Math.round((dataUrl.length * 3) / 4)
    };

    setCapturedPages(prev => [...prev, newPage]);
  };

  // Finish & Submit Pages
  const handleDone = () => {
    if (capturedPages.length > 0) {
      onPagesCaptured(capturedPages);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-2 sm:p-4">
      <div className="relative w-full max-w-4xl h-[92vh] max-h-[850px] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-b border-slate-800 text-white z-20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-base leading-tight">Live Menu Scanner Camera</h3>
              <p className="text-xs text-slate-400">Position menu page flat in bright lighting</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasTorch && (
              <button
                type="button"
                onClick={toggleTorch}
                className={`p-2 rounded-lg border transition-colors ${
                  isTorchOn
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
                title="Toggle Torch"
              >
                {isTorchOn ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
              </button>
            )}

            <button
              type="button"
              onClick={toggleCameraFacing}
              className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-colors"
              title="Flip Camera"
            >
              <SwitchCamera className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Viewport with Scanner Guide */}
        <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
          {cameraError ? (
            <div className="text-center p-8 max-w-md">
              <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
              <h4 className="text-lg font-semibold text-white mb-2">Camera Unavailable</h4>
              <p className="text-sm text-slate-300 mb-6 leading-relaxed">{cameraError}</p>
              
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition-colors inline-flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Retry Camera
                </button>

                <label className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-xl text-sm font-medium transition-colors inline-flex items-center gap-2 cursor-pointer">
                  <Camera className="w-4 h-4 text-blue-400" />
                  Upload Photo / File
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={e => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;
                      Array.from(files).forEach((file, idx) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === 'string') {
                            const newPage: ScannedMenuPage = {
                              id: `page_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 5)}`,
                              name: file.name || `Page ${existingPagesCount + capturedPages.length + idx + 1}`,
                              dataUrl: reader.result,
                              mimeType: file.type || 'image/jpeg',
                              rotation: 0,
                              timestamp: new Date().toISOString(),
                              fileSize: file.size
                            };
                            setCapturedPages(prev => [...prev, newPage]);
                          }
                        };
                        reader.readAsDataURL(file);
                      });
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
              />

              {/* Shutter flash overlay */}
              {isFlashEffect && (
                <div className="absolute inset-0 bg-white/80 pointer-events-none transition-opacity duration-150" />
              )}

              {/* Viewfinder Target Guidelines */}
              <div className="absolute inset-6 sm:inset-12 border-2 border-dashed border-blue-400/40 rounded-2xl pointer-events-none flex flex-col justify-between p-4">
                {/* 4 Corner Markers */}
                <div className="flex justify-between">
                  <div className="w-6 h-6 border-t-4 border-l-4 border-blue-500 rounded-tl-lg" />
                  <div className="w-6 h-6 border-t-4 border-r-4 border-blue-500 rounded-tr-lg" />
                </div>

                <div className="text-center">
                  <span className="bg-slate-950/75 backdrop-blur-sm text-blue-300 text-xs px-3 py-1.5 rounded-full font-medium shadow-md border border-blue-500/30">
                    Align printed menu page within borders
                  </span>
                </div>

                <div className="flex justify-between">
                  <div className="w-6 h-6 border-b-4 border-l-4 border-blue-500 rounded-bl-lg" />
                  <div className="w-6 h-6 border-b-4 border-r-4 border-blue-500 rounded-br-lg" />
                </div>
              </div>
            </>
          )}

          {/* Hidden Canvas for High-Resolution Capture */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Footer Controls & Snapped Pages Thumbnail Bar */}
        <div className="px-5 py-4 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 z-20">
          {/* Thumbnails of current batch */}
          <div className="flex items-center gap-2 overflow-x-auto max-w-full sm:max-w-xs py-1">
            {capturedPages.map((page, idx) => (
              <div
                key={page.id}
                className="relative w-12 h-16 rounded-md border border-blue-500 bg-slate-800 overflow-hidden shrink-0 shadow"
              >
                <img src={page.dataUrl} alt={`Snap ${idx + 1}`} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-slate-950/80 text-[10px] text-center text-blue-300 font-bold">
                  #{existingPagesCount + idx + 1}
                </span>
              </div>
            ))}
            {capturedPages.length === 0 && (
              <span className="text-xs text-slate-500 italic">No pages captured yet</span>
            )}
          </div>

          {/* Capture Trigger Button */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleSnap}
              disabled={!!cameraError}
              className="w-16 h-16 rounded-full bg-white hover:bg-slate-100 active:scale-95 disabled:opacity-40 text-slate-900 flex items-center justify-center shadow-lg border-4 border-slate-700 transition-all cursor-pointer"
              title="Snap Photo"
            >
              <div className="w-12 h-12 rounded-full border-2 border-slate-900 flex items-center justify-center">
                <Camera className="w-6 h-6 text-slate-900" />
              </div>
            </button>
          </div>

          {/* Done / Use Photos Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDone}
              disabled={capturedPages.length === 0}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium text-sm transition-all shadow-md flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              Use {capturedPages.length} {capturedPages.length === 1 ? 'Page' : 'Pages'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
