import { ScannedMenuPage } from '../../types/menuScanner.ts';
import { optimizeImageForOCR } from '../../utils/imageOptimizer.ts';

export interface AnalyzeMenuRequest {
  pages: Array<{
    dataUrl: string;
    mimeType: string;
    rotation?: number;
  }>;
}

export interface AnalyzeMenuResponse {
  success: boolean;
  data?: {
    menuTitle?: string;
    detectedCurrency?: string;
    notes?: string;
    categories: Array<{
      name: string;
      description?: string;
      color?: string;
      iconName?: string;
      autoPrintKitchen?: boolean;
    }>;
    products: Array<{
      name: string;
      categoryName: string;
      description?: string;
      price: number;
      cost?: number;
      unit?: string;
      sku?: string;
      isSpicy?: boolean;
      isVegetarian?: boolean;
      isGlutenFree?: boolean;
      isAlcoholic?: boolean;
      variants?: Array<{
        name: string;
        price: number;
        sku?: string;
      }>;
      modifiers?: Array<{
        name: string;
        required?: boolean;
        options: Array<{
          name: string;
          priceDelta: number;
        }>;
      }>;
    }>;
  };
  error?: string;
}

export class MenuScannerApi {
  static async analyzeMenu(pages: ScannedMenuPage[]): Promise<AnalyzeMenuResponse> {
    if (!pages || pages.length === 0) {
      throw new Error('Please provide at least one menu page image.');
    }

    // Step 1: Pre-process and optimize all images to crisp OCR resolution (max 1800px, 0.85 quality)
    // and bake in any rotation so Gemini sees upright, clean text.
    const optimizedPages = await Promise.all(
      pages.map(async (p) => {
        try {
          const opt = await optimizeImageForOCR(p.dataUrl, p.rotation || 0, 1800, 0.85);
          return {
            dataUrl: opt.dataUrl,
            mimeType: 'image/jpeg',
            rotation: 0
          };
        } catch (e) {
          return {
            dataUrl: p.dataUrl,
            mimeType: p.mimeType || 'image/jpeg',
            rotation: p.rotation || 0
          };
        }
      })
    );

    const payload: AnalyzeMenuRequest = {
      pages: optimizedPages
    };

    // Step 2: Use AbortController for network safety
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 75000); // 75s max

    try {
      const response = await fetch('/api/menu/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMsg = `Server error (${response.status}): ${response.statusText}`;
        try {
          const errJson = await response.json();
          if (errJson.error) {
            errorMsg = errJson.error;
          }
        } catch {}
        throw new Error(errorMsg);
      }

      const data: AnalyzeMenuResponse = await response.json();
      return data;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Analysis timed out. Please try with fewer pages or check your connection.');
      }
      if (err.message && err.message.includes('Failed to fetch')) {
        throw new Error('Connection error: unable to reach AI OCR service. Please verify your connection and retry.');
      }
      throw err;
    }
  }
}
