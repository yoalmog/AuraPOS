import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing large JSON payloads (up to 50mb for menu OCR)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// AI Menu Scanner API endpoint
app.post('/api/menu/analyze', async (req, res) => {
  try {
    const pages: Array<{ dataUrl: string; mimeType?: string; rotation?: number }> = req.body.pages || [];

    if (!pages || pages.length === 0) {
      return res.status(400).json({ success: false, error: 'No menu images provided.' });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please check your environment configuration.'
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

    const imageParts = pages.map((page) => {
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

      return {
        inlineData: {
          mimeType: mime,
          data: cleanBase64
        }
      };
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
5. Return clean, rich structured JSON adhering to the schema.
`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        menuTitle: { type: Type.STRING, description: 'Restaurant or menu title if visible' },
        detectedCurrency: { type: Type.STRING, description: 'Currency symbol or code (e.g. S/, $, €, £)' },
        notes: { type: Type.STRING, description: 'Any special notes, promotions or dietary remarks' },
        categories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: 'Category name' },
              description: { type: Type.STRING, description: 'Category description' },
              color: { type: Type.STRING, description: 'Hex color code' },
              iconName: { type: Type.STRING, description: 'Lucide icon name' },
              autoPrintKitchen: { type: Type.BOOLEAN, description: 'Whether category items route to kitchen' }
            }
          }
        },
        products: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: 'Product name' },
              categoryName: { type: Type.STRING, description: 'Category name' },
              description: { type: Type.STRING, description: 'Product description' },
              price: { type: Type.NUMBER, description: 'Base price as numeric float' },
              cost: { type: Type.NUMBER, description: 'Estimated ingredient cost' },
              unit: { type: Type.STRING, description: 'Unit: item, glass, cup, portion, etc.' },
              sku: { type: Type.STRING, description: 'Generated SKU' },
              isSpicy: { type: Type.BOOLEAN },
              isVegetarian: { type: Type.BOOLEAN },
              isGlutenFree: { type: Type.BOOLEAN },
              isAlcoholic: { type: Type.BOOLEAN },
              variants: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: 'Variant / size name' },
                    price: { type: Type.NUMBER, description: 'Price for variant' },
                    sku: { type: Type.STRING }
                  }
                }
              },
              modifiers: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: 'Modifier group name' },
                    required: { type: Type.BOOLEAN },
                    options: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          name: { type: Type.STRING, description: 'Option name' },
                          priceDelta: { type: Type.NUMBER, description: 'Price increase' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    let response: any = null;
    let lastError: any = null;
    const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];

    for (const modelName of modelsToTry) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: {
            parts: [...imageParts, { text: promptText }]
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema
          }
        });

        if (response && response.text) {
          break;
        }
      } catch (e: any) {
        console.warn(`Server: Model ${modelName} failed, trying next:`, e?.message || e);
        lastError = e;
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error('All AI models failed to process menu.');
    }

    const textOutput = response.text || '{}';
    let parsedData;
    try {
      parsedData = JSON.parse(textOutput);
    } catch (e) {
      const cleaned = textOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsedData = JSON.parse(cleaned);
    }

    return res.json({ success: true, data: parsedData });
  } catch (err: any) {
    console.error('Menu Scanner AI error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to process menu image with AI.'
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
