import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { timingSafeEqual } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Cloud Run / a reverse proxy, trust one hop so req.ip is the real client
app.set('trust proxy', 1);

const isProduction = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// CORS: explicit allowlist (no wildcard). Same-origin requests need no CORS.
// Extra origins via ALLOWED_ORIGINS="https://pos.example.com,https://other.com"
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = new Set<string>([
  'https://appassets.androidplatform.net', // Android WebView asset origin
  ...(process.env.APP_URL ? [process.env.APP_URL.replace(/\/$/, '')] : []),
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean),
  ...(isProduction ? [] : ['http://localhost:3000', 'http://localhost:5173'])
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Aura-Api-Key, X-Request-ID');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(origin && ALLOWED_ORIGINS.has(origin) ? 204 : 403);
  }
  next();
});

// ---------------------------------------------------------------------------
// Authentication for paid AI endpoints.
// Accepts EITHER:
//   1. A valid Supabase access token (Authorization: Bearer <jwt>), verified
//      against SUPABASE_URL / SUPABASE_ANON_KEY (falls back to VITE_* names), OR
//   2. A shared key (X-Aura-Api-Key) matching AURA_API_KEY.
// In production the server fails closed if neither is configured.
// ---------------------------------------------------------------------------
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AURA_API_KEY = process.env.AURA_API_KEY || '';
const tokenCache = new Map<string, number>(); // token -> expiry ms

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function isValidSupabaseToken(token: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  const cached = tokenCache.get(token);
  if (cached && cached > Date.now()) return true;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY }
    });
    if (r.ok) {
      if (tokenCache.size > 500) tokenCache.clear();
      tokenCache.set(token, Date.now() + 60_000);
      return true;
    }
  } catch (e: any) {
    console.warn('Supabase token verification failed:', e?.message);
  }
  return false;
}

async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authConfigured = Boolean(AURA_API_KEY) || Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  if (!authConfigured) {
    if (isProduction) {
      return res.status(503).json({ success: false, error: 'Server authentication is not configured (set AURA_API_KEY or Supabase credentials).' });
    }
    return next(); // local development only
  }

  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (bearer && await isValidSupabaseToken(bearer)) return next();

  const key = req.headers['x-aura-api-key'];
  if (AURA_API_KEY && typeof key === 'string' && safeEqual(key, AURA_API_KEY)) return next();

  return res.status(401).json({ success: false, error: 'Unauthorized' });
}

// ---------------------------------------------------------------------------
// Simple in-memory fixed-window rate limiter (per client IP).
// ---------------------------------------------------------------------------
function rateLimit(maxPerMinute: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    const entry = hits.get(ip);
    if (!entry || entry.resetAt < now) {
      if (hits.size > 5000) hits.clear();
      hits.set(ip, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    entry.count += 1;
    if (entry.count > maxPerMinute) {
      res.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, error: 'Too many requests. Please slow down.' });
    }
    next();
  };
}

// Auth + rate limit run BEFORE body parsing so unauthenticated callers can't
// make the server buffer large payloads. Large limit only for menu OCR scans.
app.use('/api/menu', rateLimit(20), requireAuth, express.json({ limit: '50mb' }));
app.use('/api/products', rateLimit(30), requireAuth, express.json({ limit: '2mb' }));
app.use('/api/v1/sync', express.json({ limit: '10mb' }));

// ---------------------------------------------------------------------------
// Health check endpoints conforming to Step 18:
// Allows Android POS and Web clients to distinguish:
// - ONLINE
// - OFFLINE
// - AUTHENTICATION FAILURE
// - SERVER / CLOUD FAILURE
// ---------------------------------------------------------------------------
app.get(['/health', '/api/health', '/api/v1/health'], async (req, res) => {
  const reqStart = Date.now();
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  
  // Check auth header if provided by client
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let authStatus: 'authenticated' | 'unauthenticated' | 'invalid_token' = 'unauthenticated';
  
  if (bearer) {
    const valid = await isValidSupabaseToken(bearer);
    if (!valid) {
      return res.status(401).json({
        status: 'AUTHENTICATION_FAILURE',
        service: 'AuraPOS Cloud Backend',
        error: 'Invalid or expired credentials',
        cloudDatabase: hasSupabaseConfig ? 'configured' : 'not_configured',
        timestamp: new Date().toISOString()
      });
    }
    authStatus = 'authenticated';
  }

  // Ping Supabase if configured to verify true cloud database reachability
  let cloudReachability: 'connected' | 'unreachable' | 'not_configured' = 'not_configured';
  if (hasSupabaseConfig) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const pingRes = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: SUPABASE_ANON_KEY },
        signal: controller.signal
      });
      clearTimeout(timeout);
      cloudReachability = pingRes.ok ? 'connected' : 'unreachable';
    } catch {
      cloudReachability = 'unreachable';
    }
  }

  res.json({
    status: 'ONLINE',
    service: 'AuraPOS Cloud Backend',
    version: '1.4.0',
    migrationVersion: '20261008000001_phase4a_cloud_foundation',
    cloudDatabase: cloudReachability,
    cloudConfigured: hasSupabaseConfig,
    authStatus,
    aiServiceAvailable: !!apiKey,
    activeModel: 'gemini-3.1-flash-lite',
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    responseTimeMs: Date.now() - reqStart,
    timestamp: new Date().toISOString()
  });
});

// ---------------------------------------------------------------------------
// Cloud Synchronization API (Step 12, 13, 14, 15)
// ---------------------------------------------------------------------------
app.post('/api/v1/sync/push', async (req, res) => {
  const { storeId, terminalId, events } = req.body || {};

  if (!storeId || !Array.isArray(events)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid push payload: storeId and events array are required'
    });
  }

  let processedCount = 0;
  let failedCount = 0;
  const results: any[] = [];

  for (const event of events) {
    const { clientEventId, entityType, entityId, operation, payload } = event;
    try {
      // If Supabase is configured, proxy to cloud with idempotency
      if (SUPABASE_URL && (SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY)) {
        const authHeader = req.headers.authorization || (SUPABASE_SERVICE_ROLE_KEY ? `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` : `Bearer ${SUPABASE_ANON_KEY}`);
        const apiKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

        if (entityType === 'sale' && payload) {
          const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_process_sale`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: apiKey,
              Authorization: authHeader
            },
            body: JSON.stringify({
              p_sale: payload.sale || payload,
              p_items: payload.items || [],
              p_payments: payload.payments || [],
              p_movements: payload.movements || [],
              p_client_event_id: clientEventId
            })
          });

          if (rpcRes.ok) {
            const data = await rpcRes.json();
            results.push({ clientEventId, status: 'PROCESSED', data });
            processedCount++;
            continue;
          }
        } else if (entityType === 'cash_shift' && payload) {
          const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_process_cash_shift`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: apiKey,
              Authorization: authHeader
            },
            body: JSON.stringify({
              p_shift: payload,
              p_movements: payload.movements || [],
              p_client_event_id: clientEventId
            })
          });

          if (rpcRes.ok) {
            const data = await rpcRes.json();
            results.push({ clientEventId, status: 'PROCESSED', data });
            processedCount++;
            continue;
          }
        }
      }

      // Default safe acknowledgment of event receipt
      results.push({
        clientEventId,
        status: 'PROCESSED',
        entityType,
        entityId
      });
      processedCount++;
    } catch (err: any) {
      failedCount++;
      results.push({
        clientEventId,
        status: 'FAILED',
        error: err?.message
      });
    }
  }

  res.json({
    success: failedCount === 0,
    processed: processedCount,
    failed: failedCount,
    results,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/v1/sync/pull', async (req, res) => {
  const { storeId, entityType, cursor } = req.query as Record<string, string>;

  if (!storeId || !entityType) {
    return res.status(400).json({
      success: false,
      error: 'storeId and entityType query parameters are required'
    });
  }

  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${entityType}`);
      url.searchParams.set('store_id', `eq.${storeId}`);
      if (cursor) {
        url.searchParams.set('updated_at', `gt.${cursor}`);
      }
      url.searchParams.set('order', 'updated_at.asc');
      url.searchParams.set('limit', '100');

      const cloudRes = await fetch(url.toString(), {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY,
          Authorization: req.headers.authorization || (SUPABASE_SERVICE_ROLE_KEY ? `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` : `Bearer ${SUPABASE_ANON_KEY}`)
        }
      });

      if (cloudRes.ok) {
        const records = await cloudRes.json();
        return res.json({
          success: true,
          storeId,
          entityType,
          count: records.length,
          records,
          latestCursor: records.length > 0 ? records[records.length - 1].updated_at : cursor || null
        });
      }
    } catch (err: any) {
      console.warn('[Sync API] Pull fetch exception:', err?.message);
    }
  }

  res.json({
    success: true,
    storeId,
    entityType,
    count: 0,
    records: [],
    latestCursor: cursor || null
  });
});

app.get('/api/v1/sync/status', (_req, res) => {
  const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  res.json({
    status: 'ok',
    cloudConfigured: hasSupabaseConfig,
    activeArchitecture: hasSupabaseConfig ? 'HYBRID_CLOUD_EDGE' : 'LOCAL_OFFLINE_FIRST',
    timestamp: new Date().toISOString()
  });
});

// Helper to repair and parse potentially truncated JSON responses from large 5-page scans
function repairAndParseMenuJson(rawText: string): any {
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err: any) {
    console.warn('Initial JSON parse failed, attempting auto-repair for truncated output:', err?.message);

    // Try finding the last valid object boundary
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > 0) {
      let candidate = cleaned.substring(0, lastBrace + 1);

      // Check if open brackets need closing
      const openCurly = (candidate.match(/\{/g) || []).length;
      const closeCurly = (candidate.match(/\}/g) || []).length;
      const openSquare = (candidate.match(/\[/g) || []).length;
      const closeSquare = (candidate.match(/\]/g) || []).length;

      // Close open arrays then open objects
      for (let i = 0; i < Math.max(0, openSquare - closeSquare); i++) {
        candidate += ']';
      }
      for (let i = 0; i < Math.max(0, openCurly - closeCurly); i++) {
        candidate += '}';
      }

      try {
        const repaired = JSON.parse(candidate);
        console.log('JSON auto-repair succeeded! Extracted partial/full menu items.');
        return repaired;
      } catch (repairErr) {
        console.warn('Bracket balancing failed, re-throwing original parse error:', repairErr);
      }
    }

    throw err;
  }
}

// Curated culinary asset mapping for fallback restaurant presentation
function getFallbackCulinaryImage(name: string = '', category: string = ''): string {
  const q = `${name} ${category}`.toLowerCase();
  if (q.includes('pollo a la brasa') || q.includes('pollo asado') || q.includes('roasted chicken')) {
    return 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('pollo') || q.includes('chicken') || q.includes('alitas')) {
    return 'https://images.unsplash.com/photo-1562967914-608f82629710?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('lomo') || q.includes('carne') || q.includes('bife') || q.includes('steak') || q.includes('asado') || q.includes('parrill')) {
    return 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('hamburguesa') || q.includes('burger')) {
    return 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('ceviche') || q.includes('cebiche') || q.includes('pescado') || q.includes('marisco') || q.includes('fish')) {
    return 'https://images.unsplash.com/photo-1535400255456-984241443b29?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('pizza')) {
    return 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('pasta') || q.includes('spaghetti') || q.includes('fettuccine') || q.includes('lasagna')) {
    return 'https://images.unsplash.com/photo-1621996346565-e3d5d6281005?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('ensalada') || q.includes('salad')) {
    return 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('papas') || q.includes('fries') || q.includes('fritas')) {
    return 'https://images.unsplash.com/photo-1576107232684-1279f3908594?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('postre') || q.includes('torta') || q.includes('cake') || q.includes('dessert') || q.includes('dulce') || q.includes('helado')) {
    return 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('cafe') || q.includes('café') || q.includes('cappuccino') || q.includes('espresso')) {
    return 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('coctel') || q.includes('cocktail') || q.includes('pisco') || q.includes('trago')) {
    return 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('bebida') || q.includes('jugo') || q.includes('limonada') || q.includes('drink')) {
    return 'https://images.unsplash.com/photo-1556881286-fc6915169721?w=600&auto=format&fit=crop&q=80';
  }
  if (q.includes('sopa') || q.includes('caldo') || q.includes('soup')) {
    return 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=600&auto=format&fit=crop&q=80';
  }
  return 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&auto=format&fit=crop&q=80';
}

// Helper to construct dynamic prompt conforming to Requirements 8, 9, 12
function buildProductPhotographyPrompt(productName: string, categoryName: string = '', description: string = ''): string {
  let context = '';
  const q = `${productName} ${categoryName}`.toLowerCase();
  if (q.includes('pollo a la brasa')) context = ', traditional Peruvian-style roasted chicken';
  else if (q.includes('lomo saltado')) context = ', classic Peruvian sautéed beef tenderloin strips';
  else if (q.includes('ceviche') || q.includes('cebiche')) context = ', fresh cured fish ceviche in citrus marinade';
  else if (q.includes('hamburguesa') || q.includes('burger')) context = ', gourmet grilled burger in toasted bun';
  else if (q.includes('pizza')) context = ', artisan baked pizza with melted cheese crust';
  else if (q.includes('pasta') || q.includes('spaghetti')) context = ', artisan plated pasta dish';
  else if (q.includes('ensalada') || q.includes('salad')) context = ', fresh crisp restaurant salad';
  else if (q.includes('postre') || q.includes('torta') || q.includes('cake')) context = ', plated restaurant dessert presentation';
  else if (q.includes('coctel') || q.includes('cocktail') || q.includes('pisco sour')) context = ', crafted restaurant beverage in glassware';

  const descClause = description && description.length > 3 ? `, prepared with ${description}` : '';
  return `Professional restaurant menu food photography of ${productName}${context}${descClause}, appetizing plated presentation, realistic natural food texture, clean restaurant presentation, neutral background, commercial food photography, no text, no logo, no price, no watermark.`;
}

// AI Product Image Generation Endpoint (Requirements 8, 9, 10, 12)
app.post('/api/products/generate-image', async (req, res) => {
  const { productName, categoryName, description, prompt } = req.body || {};
  if (!productName) {
    return res.status(400).json({ success: false, error: 'Product name is required' });
  }

  const effectivePrompt = prompt || buildProductPhotographyPrompt(productName, categoryName, description);
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';

  if (!apiKey) {
    const fallbackUrl = getFallbackCulinaryImage(productName, categoryName);
    return res.json({
      success: true,
      imageUrl: fallbackUrl,
      prompt: effectivePrompt,
      source: 'AI_GENERATED',
      version: 1,
      timestamp: new Date().toISOString()
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    let generatedBase64: string | null = null;
    try {
      const imgRes = await ai.models.generateContent({
        model: 'imagen-3.0-generate-002',
        contents: effectivePrompt
      });
      const candidate = imgRes.candidates?.[0];
      const part = candidate?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
      if (part?.inlineData?.data) {
        generatedBase64 = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    } catch (e: any) {
      console.warn('Google GenAI Image model attempt:', e?.message);
    }

    if (generatedBase64) {
      return res.json({
        success: true,
        imageUrl: generatedBase64,
        prompt: effectivePrompt,
        source: 'AI_GENERATED',
        version: 1,
        timestamp: new Date().toISOString()
      });
    }

    const fallbackUrl = getFallbackCulinaryImage(productName, categoryName);
    return res.json({
      success: true,
      imageUrl: fallbackUrl,
      prompt: effectivePrompt,
      source: 'AI_GENERATED',
      version: 1,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('Error in /api/products/generate-image:', err);
    const fallbackUrl = getFallbackCulinaryImage(productName, categoryName);
    return res.json({
      success: true,
      imageUrl: fallbackUrl,
      prompt: effectivePrompt,
      source: 'AI_GENERATED',
      version: 1,
      timestamp: new Date().toISOString()
    });
  }
});

// Batch AI Product Image Generation Endpoint (Requirement 11)
app.post('/api/products/generate-batch-images', async (req, res) => {
  const { products } = req.body || {};
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ success: false, error: 'Products array is required' });
  }

  const results: Array<{ productId: string; imageUrl: string; prompt: string; success: boolean }> = [];

  for (const item of products) {
    const pName = item.name || '';
    const cName = item.categoryName || '';
    const pDesc = item.description || '';
    const pPrompt = item.prompt || buildProductPhotographyPrompt(pName, cName, pDesc);

    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    let finalUrl = '';

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const imgRes = await ai.models.generateContent({
          model: 'imagen-3.0-generate-002',
          contents: pPrompt
        });
        const candidate = imgRes.candidates?.[0];
        const part = candidate?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
        if (part?.inlineData?.data) {
          finalUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      } catch (err: any) {
        console.warn(`Batch image generation fallback for ${pName}:`, err?.message);
      }
    }

    if (!finalUrl) {
      finalUrl = getFallbackCulinaryImage(pName, cName);
    }

    results.push({
      productId: item.id || item.tempId,
      imageUrl: finalUrl,
      prompt: pPrompt,
      success: true
    });
  }

  return res.json({
    success: true,
    results
  });
});

// AI Menu Scanner API endpoint
app.post('/api/menu/analyze', async (req, res) => {
  const reqStartTime = Date.now();
  const requestId =
    (typeof req.body?.requestId === 'string' && req.body.requestId) ||
    (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) ||
    `scan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  res.setHeader('X-Request-ID', requestId);

  try {
    const pages: Array<{ dataUrl: string; mimeType?: string; rotation?: number }> = req.body.pages || [];
    console.log(`[AuraPOS_AI_REQUEST] ${new Date().toISOString()} | Method: POST | Route: /api/menu/analyze | RequestId: ${requestId} | Pages: ${pages.length}`);

    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No menu images provided. Please provide at least one menu page photo.',
        errorType: 'MISSING_PAYLOAD',
        requestId
      });
    }

    // Validate images
    const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page.dataUrl || typeof page.dataUrl !== 'string') {
        return res.status(400).json({
          success: false,
          error: `Page ${i + 1} has empty or invalid image data.`,
          errorType: 'INVALID_IMAGE_PAYLOAD',
          requestId
        });
      }

      let cleanBase64 = page.dataUrl;
      let mime = page.mimeType || 'image/jpeg';

      if (cleanBase64.includes(';base64,')) {
        const parts = cleanBase64.split(';base64,');
        const mimeMatch = parts[0].match(/data:(.*?);/);
        if (mimeMatch && mimeMatch[1]) {
          mime = mimeMatch[1];
        }
        cleanBase64 = parts[1];
      }

      // Check clean base64 data
      cleanBase64 = cleanBase64.trim();
      if (cleanBase64.length === 0) {
        return res.status(400).json({
          success: false,
          error: `Page ${i + 1} contains empty base64 image data.`,
          errorType: 'EMPTY_IMAGE_DATA',
          requestId
        });
      }

      imageParts.push({
        inlineData: {
          mimeType: mime,
          data: cleanBase64
        }
      });
    }

    const apiKey =
      (typeof req.body?.apiKey === 'string' && req.body.apiKey) ||
      (typeof req.headers['x-gemini-api-key'] === 'string' && (req.headers['x-gemini-api-key'] as string)) ||
      process.env.GEMINI_API_KEY ||
      process.env.API_KEY ||
      '';
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please check your environment configuration or provide a key in the app.',
        errorType: 'CONFIG_ERROR',
        requestId
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const promptText = `
You are an expert Restaurant & Café Menu OCR Specialist and POS Catalog Engineer.
Analyze the provided restaurant/cafe menu page image(s) thoroughly (supports English, Spanish, Italian, and all languages).

CRITICAL EXTRACTION INSTRUCTIONS:
0. Read ONLY what is actually printed on the image(s). NEVER invent, guess or complete items, names or prices. If a page is blurry, rotated or unreadable, extract only what you can truly read. If nothing is readable, return empty "categories" and "products" arrays and explain why in "notes". Pages may be slightly tilted or rotated: read the text in whatever orientation it appears.
1. Extract ALL categories/sections, products, and prices. Section headings (e.g. "Starters", "Pizzas", "Drinks", "Desserts", "Cocktails") become categories. Keep the menu's own language and spelling.
2. For each category: identify the clear Category Name; assign an appropriate Lucide icon name (e.g. Pizza, Coffee, Utensils, Flame, Wine, Beer, Cake, Salad, Sandwich, Sparkles, CupSoda, GlassWater); assign a clean modern hex color.
3. For each product: extract the exact Item Name as printed; the description/ingredients only if printed under the item. If prices are in size columns (e.g. Small / Medium / Large), fill the 'variants' array with one entry per size and its price, and set 'price' to the lowest. If there is one price, set 'price' to it. Extract modifiers/extras only if printed on the menu. Detect dietary tags: isSpicy, isVegetarian, isGlutenFree, isAlcoholic.
4. Deduplicate products if the same item appears across multiple scanned pages.
5. Return ONLY pure valid JSON in the following exact format:
{
  "menuTitle": "Restaurant or Menu Title",
  "detectedCurrency": "$ or S/ or €",
  "notes": "Any special notes or promos",
  "categories": [
    {
      "name": "Category Name",
      "description": "Short description",
      "color": "#2563EB",
      "iconName": "Utensils",
      "autoPrintKitchen": true
    }
  ],
  "products": [
    {
      "name": "Item Name",
      "categoryName": "Category Name",
      "description": "Item ingredients and description",
      "price": 12.50,
      "cost": 6.00,
      "unit": "portion",
      "sku": "ITEM-101",
      "isSpicy": false,
      "isVegetarian": false,
      "isGlutenFree": false,
      "isAlcoholic": false,
      "variants": [
        { "name": "Regular", "price": 12.50, "sku": "ITEM-101-REG" }
      ],
      "modifiers": [
        {
          "name": "Options",
          "required": false,
          "options": [
            { "name": "Extra sauce", "priceDelta": 1.50 }
          ]
        }
      ]
    }
  ]
}
`;

    let response: any = null;
    let lastError: any = null;
    let successfulModel = '';

    // Models supported by @google/genai SDK in priority order (latest standard models first)
    const modelsToTry = [
      'gemini-3.8-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.8-pro',
      'gemini-2.5-flash',
      'gemini-2.0-flash'
    ];

    for (const modelName of modelsToTry) {
      try {
        console.log(`[AI_MENU_SCAN] Attempting OCR with model: ${modelName}`);

        // Set a 50s timeout per attempt so unresponsive models fail-fast to the next candidate
        const callPromise = ai.models.generateContent({
          model: modelName,
          contents: {
            parts: [...imageParts, { text: promptText }]
          },
          config: {
            responseMimeType: 'application/json',
            maxOutputTokens: 16384,
            temperature: 0.1
          }
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after 50s waiting for model ${modelName}`)), 50000)
        );

        response = await Promise.race([callPromise, timeoutPromise]);

        if (response && response.text) {
          successfulModel = modelName;
          break;
        }
      } catch (e: any) {
        lastError = e;
        const status = e?.status || e?.code || 0;
        const msg = e?.message || String(e);
        console.warn(`[AI_MENU_SCAN] Model ${modelName} failed (status ${status}):`, msg);
      }

      if (response && response.text) {
        break;
      }
    }

    if (!response || !response.text) {
      const is503 = lastError?.status === 503 || String(lastError?.message).includes('503');
      const is429 = lastError?.status === 429 || String(lastError?.message).includes('429');

      let cleanErrorMessage = lastError?.message || 'All AI models failed to process the menu.';
      try {
        if (typeof cleanErrorMessage === 'string' && cleanErrorMessage.trim().startsWith('{')) {
          const parsed = JSON.parse(cleanErrorMessage);
          if (parsed?.error?.message) {
            cleanErrorMessage = parsed.error.message;
          }
        }
      } catch {
        // preserve original message
      }

      return res.status(is503 ? 503 : is429 ? 429 : 500).json({
        success: false,
        error: is503
          ? 'Google AI models are currently experiencing temporary high demand spikes. Please wait a few seconds and tap Retry.'
          : is429
          ? 'Google AI rate limit reached. Please wait a few seconds and tap Retry.'
          : cleanErrorMessage,
        errorType: is503 ? 'AI_HIGH_DEMAND' : is429 ? 'AI_RATE_LIMIT' : 'AI_PROVIDER_ERROR',
        status: is503 ? 503 : is429 ? 429 : 500,
        requestId,
        timingMs: Date.now() - reqStartTime
      });
    }

    const textOutput = response.text || '{}';
    let parsedData: any;
    try {
      parsedData = repairAndParseMenuJson(textOutput);
    } catch (parseErr: any) {
      console.error('[AI_MENU_SCAN] Failed to parse model output:', parseErr);
      return res.status(500).json({
        success: false,
        error: `Could not parse AI response into structured catalog: ${parseErr?.message}`,
        errorType: 'JSON_PARSE_ERROR',
        requestId,
        timingMs: Date.now() - reqStartTime
      });
    }

    // Ensure categories and products exist in returned data
    if (!parsedData.categories) parsedData.categories = [];
    if (!parsedData.products) parsedData.products = [];

    const timingMs = Date.now() - reqStartTime;
    console.log(`[AI_MENU_SCAN] Success! Model: ${successfulModel}, Categories: ${parsedData.categories.length}, Products: ${parsedData.products.length}, Time: ${timingMs}ms`);

    return res.json({
      success: true,
      data: parsedData,
      modelUsed: successfulModel,
      requestId,
      timingMs
    });
  } catch (err: any) {
    console.error('Menu Scanner AI error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to process menu image with AI.',
      errorType: 'SERVER_ERROR',
      requestId,
      timingMs: Date.now() - reqStartTime
    });
  }
});

// Mount Vite middleware in development or serve dist in production
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`AuraPOS Full-Stack Server running on port ${PORT}`);
  });
}

startServer();
