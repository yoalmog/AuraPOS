import { ScannedMenuPage, MenuScanResult } from '../../types/menuScanner.ts';

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

    // Prepare pages payload
    const payload: AnalyzeMenuRequest = {
      pages: pages.map(p => ({
        dataUrl: p.dataUrl,
        mimeType: p.mimeType || 'image/jpeg',
        rotation: p.rotation || 0
      }))
    };

    const response = await fetch('/api/menu/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let errorMsg = `Server error: ${response.status} ${response.statusText}`;
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
  }
}
