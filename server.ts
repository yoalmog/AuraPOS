import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing large JSON payloads (up to 50mb for menu OCR)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Request-ID');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Diagnostic health check endpoints for Android reachability testing (Requirement 3)
app.get(['/health', '/api/health'], (_req, res) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  res.json({
    status: 'ok',
    service: 'AuraPOS AI Backend',
    aiServiceAvailable: !!apiKey,
    activeModel: 'gemini-3.1-flash-lite',
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
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

    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please check your environment configuration.',
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
1. Extract ALL categories/sections, products, and prices from the menu pages.
   - For example: "PIZZAS ARDIENTES", "PIZZAS COQUETAS", "PIZZAS ECOLÓGICAS", "PIZZAS DE LA CASA", "BEBIDAS", "CHICHA MORADA", "GASEOSAS", "COCTELES", "POSTRES", "ENTRADAS", "VODKA", "CERVEZA", "SANGRIA", "VINO CALIENTE", "BEBIDAS ESPIRITUOSAS DE LA BARRA", "PISCO", "RON", etc.
2. For each category:
   - Identify the clear Category Name.
   - Assign an appropriate Lucide icon name (e.g. Pizza, Coffee, Utensils, Flame, Wine, Beer, Cake, Salad, Sandwich, Sparkles, CupSoda, GlassWater).
   - Assign a clean modern hex color.
3. For each product/dish/drink:
   - Extract the exact Item Name (e.g. "LUNA ROJA", "LA DIABÓLICA", "LA SALVAJE", "LUNA DE MIEL", "LUNA NUEVA", "LA HUEVONA", "LA SALAMERA", "LA HAWAIANA", "LA GRINGA", "Chicha Morada 1/2 Litro", "Chicha Morada 1 Litro", "SCREWDRIVER", "MULA RUSA", "OJOS VERDES", "PISCO SOUR", "CUBA LIBRE", "PIÑA COLADA", "MOJITO", "DAIQUIRI", "CHILCANO DE PISCO", "SOL Y SOMBRA", "MACHUPICCHU").
   - Extract the description/ingredients (e.g. "salsa de tomate picante, mozzarella, rocoto, aceituna y oregano", "hielo, vodka y jugo de naranja", "hielo, vodka, limon y ginger ale", "hielo, pisco, ginger ale y limon", "hielo, ron, coca cola y limon", "pisco, crema de guinda, ginger ale y limon", "azúcar, hierba buena, ron, limon y cola blanca").
   - Multi-size columns handling: If prices are in columns like "Personal / Mediana / Familiar" (e.g. 17.00, 30.00, 48.00) or "Personal / No Tan Personal / De Litro" (e.g. 9.00, 12.00, 15.00), populate the 'variants' array:
     [
       { "name": "Personal", "price": 9.00 },
       { "name": "No Tan Personal", "price": 12.00 },
       { "name": "De Litro", "price": 15.00 }
     ]
     and set 'price' to the base/lowest price (e.g. 9.00).
   - If single price, set 'price' to that number.
   - Extract modifiers/extras if mentioned (e.g. "Pan al Ajo", "Extra queso", "Adicional").
   - Detect dietary tags: isSpicy (picante/spicy/chili), isVegetarian (vegetariana/ecológica), isGlutenFree, isAlcoholic (cerveza, coctel, pisco, vino, mojito, piña colada, vodka, ron).
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

    // Models supported by @google/genai SDK in priority order
    const modelsToTry = [
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.8-flash'
    ];

    for (const modelName of modelsToTry) {
      try {
        console.log(`[AI_MENU_SCAN] Attempting OCR with model: ${modelName}`);

        // Set a 25s timeout per attempt so unresponsive models fail-fast to the next candidate
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
          setTimeout(() => reject(new Error(`Timeout after 25s waiting for model ${modelName}`)), 25000)
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

      return res.status(is503 ? 503 : is429 ? 429 : 500).json({
        success: false,
        error: is503
          ? 'Google AI models are currently experiencing temporary high demand spikes. Please wait a few seconds and tap Retry.'
          : is429
          ? 'Google AI rate limit reached. Please wait a few seconds and tap Retry.'
          : (lastError?.message || 'All AI models failed to process the menu.'),
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
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
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
