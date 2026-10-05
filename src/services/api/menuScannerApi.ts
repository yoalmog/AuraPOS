import { ScannedMenuPage } from '../../types/menuScanner.ts';
import { optimizeImageForOCR } from '../../utils/imageOptimizer.ts';
import { NativeBridgeService } from '../native/NativeBridgeService.ts';

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

    // Step 1: Pre-process and optimize all images to crisp OCR resolution
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

    const payloadJson = JSON.stringify(payload);

    // Step 2: If running inside Android Native Shell, use the native bridge
    if (NativeBridgeService.isNativeAndroid() && typeof window !== 'undefined' && window.AndroidPOSNative?.analyzeMenu) {
      try {
        const nativeRes = await NativeBridgeService.menuScanner.analyzeMenuViaNative(payloadJson);
        if (nativeRes && (nativeRes.success || nativeRes.data)) {
          return nativeRes as AnalyzeMenuResponse;
        }
      } catch (err) {
        console.warn('Native bridge AI scan failed, trying web endpoints:', err);
      }
    }

    // Step 3: Candidate API Endpoints
    // If running in WebView under virtual domain or file://, target live AI Studio server
    const isVirtualOrigin =
      typeof window !== 'undefined' &&
      (window.location.host.includes('androidplatform.net') ||
        window.location.protocol === 'file:' ||
        window.location.origin === 'null');

    const candidateUrls: string[] = [];

    if (!isVirtualOrigin) {
      candidateUrls.push('/api/menu/analyze');
    }

    candidateUrls.push(
      'https://ais-dev-67yayhjbdr2qcybjx7s4jj-113121063300.us-west2.run.app/api/menu/analyze',
      'https://ais-pre-67yayhjbdr2qcybjx7s4jj-113121063300.us-west2.run.app/api/menu/analyze'
    );

    let lastError: any = null;

    for (const endpointUrl of candidateUrls) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

      try {
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: payloadJson,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data: AnalyzeMenuResponse = await response.json();
          if (data && (data.success || data.data)) {
            return data;
          }
          if (data && data.error) {
            throw new Error(data.error);
          }
        } else {
          let errText = `HTTP ${response.status}`;
          try {
            const errJson = await response.json();
            if (errJson.error) errText = errJson.error;
          } catch {}
          throw new Error(errText);
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        console.warn(`Endpoint ${endpointUrl} failed:`, err?.message || err);
        lastError = err;
      }
    }

    // If all remote AI services timed out or failed, report clearly
    if (lastError) {
      if (lastError.name === 'AbortError') {
        throw new Error('Analysis timed out. Please verify your connection or try with fewer pages.');
      }
      throw new Error(lastError.message || 'Unable to reach AI OCR service. Please check your internet connection.');
    }

    throw new Error('Could not analyze menu images. Please retry.');
  }
}
