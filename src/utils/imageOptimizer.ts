/**
 * AuraPOS - Image Optimization for AI OCR & Menu Scanning
 * 
 * Compresses and scales high-resolution smartphone menu photos (often 15-30MB each)
 * down to optimal OCR resolution (max 1800px, JPEG quality 0.85, ~300-500KB)
 * and bakes in any user rotation so Gemini sees crisp, upright text.
 * Prevents HTTP payload size limits (Cloud Run 32MB limit) and "Failed to fetch" errors.
 */

export async function optimizeImageForOCR(
  dataUrlOrBlob: string | Blob,
  rotationDegrees: number = 0,
  maxDimension: number = 1800,
  quality: number = 0.85
): Promise<{ dataUrl: string; fileSize: number }> {
  return new Promise((resolve) => {
    let srcUrl = '';
    let isObjectUrl = false;

    if (typeof dataUrlOrBlob === 'string') {
      srcUrl = dataUrlOrBlob;
    } else {
      srcUrl = URL.createObjectURL(dataUrlOrBlob);
      isObjectUrl = true;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (isObjectUrl) {
        URL.revokeObjectURL(srcUrl);
      }

      const origWidth = img.naturalWidth || img.width;
      const origHeight = img.naturalHeight || img.height;

      if (!origWidth || !origHeight) {
        // Fallback to original string if dimensions are invalid
        const str = typeof dataUrlOrBlob === 'string' ? dataUrlOrBlob : '';
        resolve({ dataUrl: str, fileSize: Math.round((str.length * 3) / 4) });
        return;
      }

      // Calculate scaled dimensions
      let targetWidth = origWidth;
      let targetHeight = origHeight;

      if (targetWidth > maxDimension || targetHeight > maxDimension) {
        if (targetWidth > targetHeight) {
          targetHeight = Math.round((targetHeight * maxDimension) / targetWidth);
          targetWidth = maxDimension;
        } else {
          targetWidth = Math.round((targetWidth * maxDimension) / targetHeight);
          targetHeight = maxDimension;
        }
      }

      // Create off-screen canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });

      if (!ctx) {
        const str = typeof dataUrlOrBlob === 'string' ? dataUrlOrBlob : '';
        resolve({ dataUrl: str, fileSize: Math.round((str.length * 3) / 4) });
        return;
      }

      const normRotation = ((rotationDegrees % 360) + 360) % 360;

      // Adjust canvas size based on rotation
      if (normRotation === 90 || normRotation === 270) {
        canvas.width = targetHeight;
        canvas.height = targetWidth;
      } else {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      // Fill white background for clean OCR
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Apply rotation transformation
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((normRotation * Math.PI) / 180);
      ctx.drawImage(img, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
      ctx.restore();

      const optimizedDataUrl = canvas.toDataURL('image/jpeg', quality);
      const estSize = Math.round((optimizedDataUrl.length * 3) / 4);

      resolve({
        dataUrl: optimizedDataUrl,
        fileSize: estSize
      });
    };

    img.onerror = () => {
      if (isObjectUrl) {
        URL.revokeObjectURL(srcUrl);
      }
      const str = typeof dataUrlOrBlob === 'string' ? dataUrlOrBlob : '';
      resolve({ dataUrl: str, fileSize: Math.round((str.length * 3) / 4) });
    };

    img.src = srcUrl;
  });
}

export async function optimizeFileList(
  files: File[]
): Promise<Array<{ id: string; name: string; dataUrl: string; fileSize: number; mimeType: string }>> {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const optimized = await optimizeImageForOCR(file, 0, 1800, 0.85);
      results.push({
        id: `page_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        name: file.name || `Page ${i + 1}`,
        dataUrl: optimized.dataUrl,
        fileSize: optimized.fileSize,
        mimeType: 'image/jpeg'
      });
    } catch {
      // Fallback
    }
  }
  return results;
}
