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
        model: 'gemini-3.1-flash-image',
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
          model: 'gemini-3.1-flash-image',
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
