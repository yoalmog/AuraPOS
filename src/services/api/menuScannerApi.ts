import { ScannedMenuPage } from '../../types/menuScanner.ts';
import { optimizeImageForOCR, validateMenuPageImage } from '../../utils/imageOptimizer.ts';
import { NativeBridgeService } from '../native/NativeBridgeService.ts';
import { StorageService } from '../storageService.ts';

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
  errorType?: string;
  status?: number;
  requestId?: string;
  timingMs?: number;
  modelUsed?: string;
}

export type ExtractionErrorType =
  | 'OFFLINE_ERROR'
  | 'TIMEOUT_ERROR'
  | 'ABORT_ERROR'
  | 'NETWORK_ERROR'
  | 'CORS_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_IMAGE'
  | 'EMPTY_IMAGE'
  | 'CONFIG_ERROR'
  | 'AI_HIGH_DEMAND'
  | 'AI_RATE_LIMIT'
  | 'AI_PROVIDER_ERROR'
  | 'JSON_PARSE_ERROR'
  | 'HTTP_ERROR'
  | 'UNKNOWN_ERROR';

export class ExtractionDiagnosticError extends Error {
  stage: string;
  endpoint: string;
  method: string;
  status: number;
  statusText: string;
  errorType: ExtractionErrorType;
  requestId: string;
  timestamp: string;

  constructor(opts: {
    stage: string;
    endpoint: string;
    method?: string;
    status?: number;
    statusText?: string;
    errorType: ExtractionErrorType;
    message: string;
    requestId?: string;
  }) {
    super(opts.message);
    this.name = 'ExtractionDiagnosticError';
    this.stage = opts.stage;
    this.endpoint = opts.endpoint;
    this.method = opts.method || 'POST';
    this.status = opts.status || 0;
    this.statusText = opts.statusText || '';
    this.errorType = opts.errorType;
    this.requestId = opts.requestId || `diag_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.timestamp = new Date().toISOString();

    // Log structured diagnostic in development environment (Section 3 requirement)
    this.logDiagnostic();
  }

  logDiagnostic() {
    const isDev =
      typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'
        ? true
        : typeof import.meta !== 'undefined' && import.meta.env?.DEV;

    if (isDev || typeof window !== 'undefined') {
      console.error('[AI_MENU_EXTRACTION_ERROR]', {
        stage: this.stage,
        endpoint: this.endpoint,
        method: this.method,
        status: this.status,
        statusText: this.statusText,
        errorType: this.errorType,
        message: this.message,
        requestId: this.requestId,
        timestamp: this.timestamp
      });
    }
  }
}

export class MenuScannerApi {
  /**
   * Resolve best candidate endpoints for the current runtime (Web, PWA, or Android APK)
   */
  static getCandidateEndpoints(): string[] {
    const endpoints: string[] = [];

    // 1. Check user-configured custom server URL in Store Settings
    try {
      const settings = StorageService.getSettings();
      if (settings?.apiServerUrl && typeof settings.apiServerUrl === 'string') {
        const cleanBase = settings.apiServerUrl.replace(/\/+$/, '');
        endpoints.push(`${cleanBase}/api/menu/analyze`);
      }
    } catch {}

    // 2. Relative endpoint: Best for Web, PWA, and Dev Server (Same-Origin, No CORS, No Cookie redirects)
    const isBrowser = typeof window !== 'undefined';
    const isVirtualAndroid =
      isBrowser &&
      (window.location.host.includes('androidplatform.net') ||
        window.location.protocol === 'file:' ||
        window.location.origin === 'null');

    if (!isVirtualAndroid) {
      endpoints.push('/api/menu/analyze');
    }

    // 3. Fallback to production/environment Cloud Run URL if available
    const envUrl = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_URL : '';
    if (envUrl && typeof envUrl === 'string' && !endpoints.includes(`${envUrl.replace(/\/+$/, '')}/api/menu/analyze`)) {
      endpoints.push(`${envUrl.replace(/\/+$/, '')}/api/menu/analyze`);
    }

    // 4. Default same-origin fallback if running in virtual Android container
    if (isVirtualAndroid && endpoints.length === 0) {
      // In Android WebView, if no server URL is provided, target the default hosted cloud backend
      endpoints.push('https://ais-dev-67yayhjbdr2qcybjx7s4jj-113121063300.us-west2.run.app/api/menu/analyze');
    }

    return endpoints;
  }

  /**
   * Analyze multiple menu pages using Gemini Multimodal Vision AI
   */
  static async analyzeMenu(
    pages: ScannedMenuPage[],
    onProgress?: (stage: string) => void
  ): Promise<AnalyzeMenuResponse> {
    const requestId = `scan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Check device network connectivity
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ExtractionDiagnosticError({
        stage: 'OFFLINE_CHECK',
        endpoint: 'client_network',
        errorType: 'OFFLINE_ERROR',
        message: 'Your device is currently offline. An active internet connection is required to analyze menus with AI.',
        requestId
      });
    }

    // Step 1: Validate input pages
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      throw new ExtractionDiagnosticError({
        stage: 'VALIDATION',
        endpoint: 'client_validation',
        errorType: 'EMPTY_IMAGE',
        message: 'Please provide at least one menu page photo to analyze.',
        requestId
      });
    }

    onProgress?.(`Validating ${pages.length} menu ${pages.length === 1 ? 'page' : 'pages'}...`);

    // Step 2: Pre-process and optimize images to crisp, lean OCR resolution
    onProgress?.('Optimizing high-resolution images for crisp OCR recognition...');

    const optimizedPages: Array<{ dataUrl: string; mimeType: string; rotation: number }> = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const validation = validateMenuPageImage(page.dataUrl, page.mimeType);
      if (!validation.isValid) {
        throw new ExtractionDiagnosticError({
          stage: 'IMAGE_VALIDATION',
          endpoint: 'client_preprocessing',
          errorType: 'INVALID_IMAGE',
          message: `Page ${i + 1} (${page.name || 'Untitled'}) has invalid data: ${validation.error}`,
          requestId
        });
      }

      try {
        const opt = await optimizeImageForOCR(page.dataUrl, page.rotation || 0, 1500, 0.82);
        optimizedPages.push({
          dataUrl: opt.dataUrl,
          mimeType: 'image/jpeg',
          rotation: 0
        });
      } catch (err: any) {
        console.warn(`[AI_MENU_SCAN] Compression failed for page ${i + 1}, using original:`, err);
        optimizedPages.push({
          dataUrl: page.dataUrl,
          mimeType: page.mimeType || 'image/jpeg',
          rotation: page.rotation || 0
        });
      }
    }

    const payload: AnalyzeMenuRequest = {
      pages: optimizedPages
    };

    const payloadJson = JSON.stringify(payload);
    const payloadSizeBytes = new Blob([payloadJson]).size;
    const payloadMb = (payloadSizeBytes / (1024 * 1024)).toFixed(2);
    console.log(`[AI_MENU_SCAN] Total request payload: ${payloadMb} MB across ${optimizedPages.length} pages.`);

    if (payloadSizeBytes > 28 * 1024 * 1024) {
      throw new ExtractionDiagnosticError({
        stage: 'PAYLOAD_SIZE_CHECK',
        endpoint: 'client_preprocessing',
        errorType: 'PAYLOAD_TOO_LARGE',
        message: `Total menu images payload (${payloadMb} MB) exceeds maximum safe upload size (28 MB). Please scan 2-3 pages at a time.`,
        requestId
      });
    }

    // Step 3: If running inside Android Native Shell with native AI scanner capability
    if (
      NativeBridgeService.isNativeAndroid() &&
      typeof window !== 'undefined' &&
      window.AndroidPOSNative?.analyzeMenu
    ) {
      try {
        onProgress?.('Analyzing via Android hardware acceleration...');
        const nativeRes = await NativeBridgeService.menuScanner.analyzeMenuViaNative(payloadJson);
        if (nativeRes && (nativeRes.success || nativeRes.data)) {
          return nativeRes as AnalyzeMenuResponse;
        }
      } catch (err: any) {
        console.warn('Native bridge AI scan failed, falling back to web API:', err);
      }
    }

    // Step 4: Execute Request with structured error handling & timeouts
    const candidateUrls = this.getCandidateEndpoints();
    let lastDiagnosticError: ExtractionDiagnosticError | null = null;

    onProgress?.('Connecting to Gemini AI Vision OCR service...');

    for (let u = 0; u < candidateUrls.length; u++) {
      const endpointUrl = candidateUrls[u];
      const controller = new AbortController();
      // 120 second timeout for 5 large menu pages
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      try {
        console.log(`[AI_MENU_SCAN] Sending request to endpoint: ${endpointUrl} (timeout 120s)`);
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: payloadJson,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // If server responded with an HTTP status:
        // DO NOT fall through to other endpoints! The server was reached!
        if (response.ok) {
          const result: AnalyzeMenuResponse = await response.json();
          if (result && (result.success || result.data)) {
            return result;
          }
          if (result && result.error) {
            throw new ExtractionDiagnosticError({
              stage: 'AI_EXTRACTION',
              endpoint: endpointUrl,
              status: response.status,
              statusText: response.statusText,
              errorType: (result.errorType as ExtractionErrorType) || 'AI_PROVIDER_ERROR',
              message: result.error,
              requestId
            });
          }
        } else {
          // Server returned an error HTTP status (400, 413, 500, 503, etc.)
          let serverErrorMsg = `HTTP Error ${response.status}: ${response.statusText}`;
          let errorType: ExtractionErrorType = 'HTTP_ERROR';

          try {
            const errJson = await response.json();
            if (errJson.error) {
              serverErrorMsg = errJson.error;
            }
            if (errJson.errorType) {
              errorType = errJson.errorType;
            }
          } catch {}

          if (response.status === 413) {
            errorType = 'PAYLOAD_TOO_LARGE';
            serverErrorMsg = 'Upload payload too large for the server. Please try with fewer pages.';
          } else if (response.status === 503) {
            errorType = 'AI_HIGH_DEMAND';
            serverErrorMsg =
              'Google AI is currently experiencing high demand spikes. Please wait a few moments and tap Retry.';
          } else if (response.status === 429) {
            errorType = 'AI_RATE_LIMIT';
            serverErrorMsg = 'Google AI rate limit reached. Please wait a few seconds and tap Retry.';
          }

          throw new ExtractionDiagnosticError({
            stage: 'SERVER_RESPONSE',
            endpoint: endpointUrl,
            status: response.status,
            statusText: response.statusText,
            errorType,
            message: serverErrorMsg,
            requestId
          });
        }
      } catch (err: any) {
        clearTimeout(timeoutId);

        // If it is already an ExtractionDiagnosticError from a valid HTTP response, DO NOT retry external endpoints!
        if (err instanceof ExtractionDiagnosticError && err.status > 0) {
          throw err;
        }

        // Determine specific network failure type
        let errorType: ExtractionErrorType = 'NETWORK_ERROR';
        let userMessage = 'Could not connect to AI Menu Scanner service.';

        if (err.name === 'AbortError') {
          errorType = 'TIMEOUT_ERROR';
          userMessage =
            'Analysis timed out after 90 seconds. For very large 5-page menus, please verify your internet speed or try scanning 2-3 pages at a time.';
        } else if (err.message && err.message.toLowerCase().includes('failed to fetch')) {
          errorType = 'NETWORK_ERROR';
          userMessage =
            'Network request failed. Could not establish connection to the AuraPOS AI backend. Please verify your internet connection or backend server URL.';
        } else if (err.message) {
          userMessage = err.message;
        }

        lastDiagnosticError = new ExtractionDiagnosticError({
          stage: 'NETWORK_FETCH',
          endpoint: endpointUrl,
          status: 0,
          statusText: err.name || 'NETWORK_FAILURE',
          errorType,
          message: userMessage,
          requestId
        });

        console.warn(`[AI_MENU_SCAN] Candidate endpoint ${endpointUrl} failed:`, err);
      }
    }

    if (lastDiagnosticError) {
      throw lastDiagnosticError;
    }

    throw new ExtractionDiagnosticError({
      stage: 'COMPLETION',
      endpoint: 'unknown',
      errorType: 'UNKNOWN_ERROR',
      message: 'Menu scanning could not be completed. Please try again.',
      requestId
    });
  }
}
