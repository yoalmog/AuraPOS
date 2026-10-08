import { ScannedMenuPage } from '../../types/menuScanner.ts';
import { getApiAuthHeaders } from './authHeaders.ts';
import { optimizeImageForOCR, validateMenuPageImage } from '../../utils/imageOptimizer.ts';
import { NativeBridgeService } from '../native/NativeBridgeService.ts';
import { StorageService } from '../storageService.ts';

export interface AnalyzeMenuRequest {
  requestId?: string;
  endpointUrl?: string;
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
  errorType?: ExtractionErrorType;
  status?: number;
  requestId?: string;
  timingMs?: number;
  modelUsed?: string;
}

// Requirement 17: Granular, structured network and runtime failure states
export type ExtractionErrorType =
  | 'NO_INTERNET'
  | 'BACKEND_UNREACHABLE'
  | 'BACKEND_TIMEOUT'
  | 'TLS_ERROR'
  | 'DNS_ERROR'
  | 'HTTP_401'
  | 'HTTP_403'
  | 'HTTP_404'
  | 'HTTP_429'
  | 'HTTP_500'
  | 'HTTP_502'
  | 'HTTP_503'
  | 'INVALID_RESPONSE'
  | 'AI_PROVIDER_ERROR'
  | 'AI_HIGH_DEMAND'
  | 'AI_RATE_LIMIT'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_IMAGE'
  | 'EMPTY_IMAGE'
  | 'CONFIG_ERROR'
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

    this.logDiagnostic();
  }

  logDiagnostic() {
    const isDev =
      typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'
        ? true
        : typeof import.meta !== 'undefined' && import.meta.env?.DEV;

    // Structured development diagnostic logger without secrets or credentials (Requirement 3 & 20)
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
   * Returns the primary target backend base URL for display in diagnostics & settings
   */
  static getEffectiveBackendUrl(): string {
    try {
      const settings = StorageService.getSettings();
      if (settings?.apiServerUrl && typeof settings.apiServerUrl === 'string' && settings.apiServerUrl.trim()) {
        return settings.apiServerUrl.trim().replace(/\/+$/, '');
      }
    } catch {}

    const envUrl = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_URL : '';
    if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
      return envUrl.trim().replace(/\/+$/, '');
    }

    const isBrowser = typeof window !== 'undefined';
    const isVirtualAndroid =
      isBrowser &&
      (window.location.host.includes('androidplatform.net') ||
        window.location.protocol === 'file:' ||
        window.location.origin === 'null');

    if (!isVirtualAndroid && isBrowser && window.location.origin && window.location.origin !== 'null') {
      return window.location.origin;
    }

    return 'https://api.aurapos.com';
  }

  /**
   * Resolve valid, verified candidate endpoints for the current runtime (Web, PWA, or Android APK)
   * Note: NEVER defaults to ephemeral AI Studio development proxy URLs that require session cookies.
   */
  static getCandidateEndpoints(): string[] {
    const endpoints: string[] = [];

    // 1. User-configured custom server URL from Settings -> System Diagnostics -> AI Backend
    try {
      const settings = StorageService.getSettings();
      if (settings?.apiServerUrl && typeof settings.apiServerUrl === 'string' && settings.apiServerUrl.trim()) {
        const cleanBase = settings.apiServerUrl.trim().replace(/\/+$/, '');
        endpoints.push(`${cleanBase}/api/menu/analyze`);
      }
    } catch {}

    // 2. Build-time environment variable (e.g. VITE_API_URL)
    const envUrl = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_URL : '';
    if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
      const cleanEnv = envUrl.trim().replace(/\/+$/, '');
      const fullUrl = `${cleanEnv}/api/menu/analyze`;
      if (!endpoints.includes(fullUrl)) {
        endpoints.push(fullUrl);
      }
    }

    // 3. Same-Origin Relative Endpoint (Best for Web, PWA, and Dev Server — zero CORS, direct proxy)
    const isBrowser = typeof window !== 'undefined';
    const isVirtualAndroid =
      isBrowser &&
      (window.location.host.includes('androidplatform.net') ||
        window.location.protocol === 'file:' ||
        window.location.origin === 'null');

    if (!isVirtualAndroid) {
      endpoints.push('/api/menu/analyze');
    }

    // 4. Default production cloud backend if running in standalone Android APK
    if (endpoints.length === 0) {
      endpoints.push('https://api.aurapos.com/api/menu/analyze');
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

    // Requirement 23: Offline check - scanned menu pages remain preserved locally
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ExtractionDiagnosticError({
        stage: 'OFFLINE_CHECK',
        endpoint: 'client_network',
        errorType: 'NO_INTERNET',
        message: 'Your device is currently offline. An active internet connection is required to analyze menus with AI. Scanned pages are preserved locally.',
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

    // Requirement 18: Progressive status reporting
    onProgress?.('Connecting to AI...');

    // Step 2: Pre-process and optimize images to crisp, lean OCR resolution
    onProgress?.('Uploading menu...');

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
        const opt = await optimizeImageForOCR(page.dataUrl, page.rotation || 0, 2200, 0.88);
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

    const candidateUrls = this.getCandidateEndpoints();
    const primaryEndpoint = candidateUrls[0];

    // Payload includes requestId and target endpointUrl for Android native forwarder (Requirement 19 & 22)
    const payload: AnalyzeMenuRequest = {
      requestId,
      endpointUrl: primaryEndpoint,
      pages: optimizedPages
    };

    const payloadJson = JSON.stringify(payload);
    const payloadSizeBytes = new Blob([payloadJson]).size;
    const payloadMb = (payloadSizeBytes / (1024 * 1024)).toFixed(2);

    if (payloadSizeBytes > 28 * 1024 * 1024) {
      throw new ExtractionDiagnosticError({
        stage: 'PAYLOAD_SIZE_CHECK',
        endpoint: 'client_preprocessing',
        errorType: 'PAYLOAD_TOO_LARGE',
        message: `Total menu images payload (${payloadMb} MB) exceeds maximum safe upload size (28 MB). Scanned pages are preserved locally.`,
        requestId
      });
    }

    onProgress?.('Analyzing menu...');

    // Step 3: If running inside Android Native Shell with native AI scanner capability
    if (
      NativeBridgeService.isNativeAndroid() &&
      typeof window !== 'undefined' &&
      window.AndroidPOSNative?.analyzeMenu
    ) {
      try {
        const nativeRes = await NativeBridgeService.menuScanner.analyzeMenuViaNative(JSON.stringify({ ...payload, authHeaders: await getApiAuthHeaders() }));
        if (nativeRes && nativeRes.success && nativeRes.data) {
          onProgress?.('Processing results...');
          return nativeRes as AnalyzeMenuResponse;
        }

        // If native bridge returned an error, capture structured diagnostic without swallowing
        if (nativeRes && !nativeRes.success) {
          const errType = (nativeRes as any).errorType || 'BACKEND_UNREACHABLE';
          throw new ExtractionDiagnosticError({
            stage: 'ANDROID_NATIVE_BRIDGE',
            endpoint: primaryEndpoint,
            status: (nativeRes as any).status || 0,
            statusText: 'NATIVE_BRIDGE_ERROR',
            errorType: errType as ExtractionErrorType,
            message: nativeRes.error || 'Native bridge could not establish connection to the AuraPOS AI backend.',
            requestId
          });
        }
      } catch (err: any) {
        if (err instanceof ExtractionDiagnosticError) {
          throw err;
        }
        console.warn('Native bridge AI scan returned exception, falling back to web fetch:', err);
      }
    }

    // Step 4: Execute Web/HTTP Request with structured error handling & 120s timeout
    let lastDiagnosticError: ExtractionDiagnosticError | null = null;

    for (let u = 0; u < candidateUrls.length; u++) {
      const endpointUrl = candidateUrls[u];
      const controller = new AbortController();
      // 120-second timeout for multi-page vision models
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      try {
        console.log(`[AI_MENU_SCAN] Sending request to endpoint: ${endpointUrl} (timeout 120s, RequestId: ${requestId})`);
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Request-ID': requestId,
            ...(await getApiAuthHeaders())
          },
          body: payloadJson,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // If server responded with an HTTP status, do NOT retry other endpoints!
        if (response.ok) {
          onProgress?.('Processing results...');
          const result: AnalyzeMenuResponse = await response.json();
          if (result && (result.success || result.data)) {
            return result;
          }
          if (result && result.error) {
            throw new ExtractionDiagnosticError({
              stage: 'AI_PROVIDER_PROCESSING',
              endpoint: endpointUrl,
              status: response.status,
              statusText: response.statusText,
              errorType: (result.errorType as ExtractionErrorType) || 'AI_PROVIDER_ERROR',
              message: result.error,
              requestId
            });
          }
        } else {
          // Server returned an error HTTP status (400, 401, 403, 404, 413, 429, 500, 502, 503)
          let serverErrorMsg = `Server responded with HTTP ${response.status}: ${response.statusText}`;
          let errorType: ExtractionErrorType = `HTTP_${response.status}` as ExtractionErrorType;

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
            serverErrorMsg = 'Upload payload too large for the server. Scanned pages are preserved locally.';
          } else if (response.status === 503) {
            errorType = 'AI_HIGH_DEMAND';
            serverErrorMsg = 'Google AI is currently experiencing high demand spikes. Please wait a few moments and tap Retry Extraction.';
          } else if (response.status === 429) {
            errorType = 'AI_RATE_LIMIT';
            serverErrorMsg = 'Google AI rate limit reached. Please wait a few seconds and tap Retry Extraction.';
          } else if (response.status === 404) {
            errorType = 'HTTP_404';
            serverErrorMsg = `The API endpoint '${endpointUrl}' was not found (404). Please verify your backend server URL in Settings → AI Backend.`;
          } else if (response.status === 401 || response.status === 403) {
            errorType = response.status === 401 ? 'HTTP_401' : 'HTTP_403';
            serverErrorMsg = `Access to backend was denied (HTTP ${response.status}). Check authentication credentials or proxy gateway.`;
          } else if (response.status === 502) {
            errorType = 'HTTP_502';
            serverErrorMsg = 'Bad Gateway (502). The upstream server failed to respond.';
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

        // If it is already an ExtractionDiagnosticError from a valid HTTP response, DO NOT retry!
        if (err instanceof ExtractionDiagnosticError && err.status > 0) {
          throw err;
        }

        // Determine specific network failure state (Requirement 17)
        let errorType: ExtractionErrorType = 'BACKEND_UNREACHABLE';
        let userMessage = `Could not establish connection to the AuraPOS AI backend (${endpointUrl}).`;

        if (err.name === 'AbortError') {
          errorType = 'BACKEND_TIMEOUT';
          userMessage = 'AI analysis timed out. The menu pages are preserved locally. Please retry.';
        } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
          errorType = 'NO_INTERNET';
          userMessage = 'Your device is offline. An active internet connection is required. Scanned pages are preserved locally.';
        } else if (err.message && (err.message.includes('SSL') || err.message.includes('certificate') || err.message.includes('CERT'))) {
          errorType = 'TLS_ERROR';
          userMessage = 'TLS/SSL certificate handshake failed. Verify server security configuration.';
        } else if (err.message && (err.message.includes('ENOTFOUND') || err.message.includes('DNS') || err.message.includes('getaddrinfo'))) {
          errorType = 'DNS_ERROR';
          userMessage = 'DNS lookup failed. The hostname could not be resolved.';
        } else if (err.message && err.message.toLowerCase().includes('failed to fetch')) {
          errorType = 'BACKEND_UNREACHABLE';
          userMessage = `Could not establish connection to the AuraPOS AI backend at ${endpointUrl}. Please check network connectivity or configure your server in Settings → AI Backend.`;
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
      message: 'Menu scanning could not be completed. The menu pages are preserved locally. Please retry.',
      requestId
    });
  }
}
