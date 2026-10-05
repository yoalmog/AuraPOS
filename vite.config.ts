import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import net from 'net';
import { GoogleGenAI, Type } from '@google/genai';

function menuScannerPlugin(): Plugin {
  return {
    name: 'menu-scanner-api',
    configureServer(server) {
      server.middlewares.use('/api/menu/analyze', async (req, res) => {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }));
          return;
        }

        let body = '';
        req.on('data', chunk => {
          body += chunk;
        });

        req.on('error', (err) => {
          console.error('Request stream error:', err);
          if (!res.headersSent) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: 'Failed to read request stream' }));
          }
        });

        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const parsed = JSON.parse(body || '{}');
            const pages: Array<{ dataUrl: string; mimeType?: string; rotation?: number }> = parsed.pages || [];

            if (!pages || pages.length === 0) {
              res.statusCode = 400;
              res.end(JSON.stringify({ success: false, error: 'No menu images provided.' }));
              return;
            }

            const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
            if (!apiKey) {
              res.statusCode = 500;
              res.end(
                JSON.stringify({
                  success: false,
                  error: 'GEMINI_API_KEY is not configured on the server. Please check your environment configuration.'
                })
              );
              return;
            }

            const ai = new GoogleGenAI({
              apiKey,
              httpOptions: {
                headers: {
                  'User-Agent': 'aistudio-build'
                }
              }
            });

            // Prepare inline image parts
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
   - For example: "PIZZAS ARDIENTES", "PIZZAS COQUETAS", "PIZZAS ECOLÓGICAS", "PIZZAS DE LA CASA", "BEBIDAS", "CHICHA MORADA", "GASEOSAS", "COCTELES", "POSTRES", "ENTRADAS", etc.
2. For each category:
   - Identify the clear Category Name.
   - Assign an appropriate Lucide icon name (e.g. Pizza, Coffee, Utensils, Flame, Wine, Beer, Cake, Salad, Sandwich, Sparkles, CupSoda).
   - Assign a clean hex color.
3. For each product/dish/drink:
   - Extract the exact Item Name (e.g. "LUNA ROJA", "LA DIABÓLICA", "LA SALVAJE", "LUNA DE MIEL", "LUNA NUEVA", "LA HUEVONA", "LA SALAMERA", "LA HAWAIANA", "LA GRINGA", "Chicha Morada 1/2 Litro", "Chicha Morada 1 Litro").
   - Extract the description/ingredients (e.g. "salsa de tomate picante, mozzarella, rocoto, aceituna y oregano", "piña, durazno, leche condensada, canela").
   - Multi-size columns handling: If prices are in columns like "Personal / Mediana / Familiar" (e.g. 17.00, 30.00, 48.00), populate the 'variants' array:
     [
       { "name": "Personal", "price": 17.00 },
       { "name": "Mediana", "price": 30.00 },
       { "name": "Familiar", "price": 48.00 }
     ]
     and set 'price' to the base/lowest price (e.g. 17.00).
   - If single price, set 'price' to that number.
   - Extract modifiers/extras if mentioned (e.g. "Pan al Ajo", "Extra queso", "Adicional").
   - Detect dietary tags: isSpicy (picante/spicy/chili), isVegetarian (vegetariana/ecológica), isGlutenFree, isAlcoholic (cerveza, coctel, pisco, vino, mojito, piña colada).
4. Deduplicate products if the same item appears across multiple scanned pages.
5. Return clean, rich structured JSON adhering to the schema.
`;

            let response: any = null;
            let lastError: any = null;
            const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];

            for (const modelName of modelsToTry) {
              try {
                response = await ai.models.generateContent({
                  model: modelName,
                  contents: {
                    parts: [...imageParts, { text: promptText }]
                  },
                  config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
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
                            },
                            required: ['name']
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
                                  },
                                  required: ['name', 'price']
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
                                        },
                                        required: ['name', 'priceDelta']
                                      }
                                    }
                                  },
                                  required: ['name', 'options']
                                }
                              }
                            },
                            required: ['name', 'categoryName', 'price']
                          }
                        }
                      },
                      required: ['categories', 'products']
                    }
                  }
                });

                if (response && response.text) {
                  break; // Successful response
                }
              } catch (e: any) {
                console.warn(`Model ${modelName} failed, trying next candidate:`, e?.message || e);
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

            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, data: parsedData }));
          } catch (err: any) {
            console.error('Menu Scanner AI error:', err);
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                success: false,
                error: err?.message || 'Failed to process menu image with AI.'
              })
            );
          }
        });
      });
    }
  };
}

function printerBridgePlugin(): Plugin {
  return {
    name: 'printer-bridge-api',
    configureServer(server) {
      server.middlewares.use('/api/printer/lan-probe', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', chunk => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const { ip, port } = JSON.parse(body || '{}');
            const targetPort = Number(port) || 9100;
            const startTime = Date.now();

            const socket = net.createConnection({
              host: ip,
              port: targetPort,
              timeout: 2500
            });

            socket.on('connect', () => {
              const latencyMs = Date.now() - startTime;
              socket.destroy();
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, latencyMs }));
            });

            socket.on('timeout', () => {
              socket.destroy();
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: false,
                  error: `Connection timed out after 2500ms to ${ip}:${targetPort}`
                })
              );
            });

            socket.on('error', err => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            });
          } catch (e: any) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
      });

      server.middlewares.use('/api/printer/lan-print', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', chunk => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const { ip, port, base64Data } = JSON.parse(body || '{}');
            const targetPort = Number(port) || 9100;
            const buffer = Buffer.from(base64Data || '', 'base64');

            const socket = net.createConnection({
              host: ip,
              port: targetPort,
              timeout: 4000
            });

            socket.on('connect', () => {
              socket.write(buffer, () => {
                socket.end();
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
              });
            });

            socket.on('timeout', () => {
              socket.destroy();
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: false,
                  error: `Print connection timeout to ${ip}:${targetPort}`
                })
              );
            });

            socket.on('error', err => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            });
          } catch (e: any) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
      });
    }
  };
}

function categoryApiPlugin(): Plugin {
  // In-memory server-side state for categories & translations
  let categories: any[] = [];
  let categoryTranslations: any[] = [];
  let products: any[] = [];

  return {
    name: 'category-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = urlObj.pathname;

        if (!pathname.startsWith('/api/v1/categories')) {
          return next();
        }

        const method = req.method;
        res.setHeader('Content-Type', 'application/json');

        let body = '';
        req.on('data', chunk => {
          body += chunk;
        });

        req.on('end', () => {
          let parsedBody: any = {};
          if (body) {
            try {
              parsedBody = JSON.parse(body);
            } catch {}
          }

          // 1. PATCH /api/v1/categories/reorder
          if (pathname === '/api/v1/categories/reorder' && method === 'PATCH') {
            const { orderedIds } = parsedBody;
            if (Array.isArray(orderedIds)) {
              orderedIds.forEach((id: string, idx: number) => {
                const cat = categories.find(c => c.id === id);
                if (cat) cat.sortOrder = idx + 1;
              });
            }
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, categories }));
            return;
          }

          // 2. GET /api/v1/categories
          if (pathname === '/api/v1/categories' && method === 'GET') {
            res.statusCode = 200;
            res.end(JSON.stringify(categories));
            return;
          }

          // 3. POST /api/v1/categories
          if (pathname === '/api/v1/categories' && method === 'POST') {
            const cat = parsedBody.category || parsedBody;
            if (!cat.name || !cat.name.trim()) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Category name is required.' }));
              return;
            }
            const duplicate = categories.find(
              c => c.name.trim().toLowerCase() === cat.name.trim().toLowerCase() && c.id !== cat.id
            );
            if (duplicate) {
              res.statusCode = 409;
              res.end(JSON.stringify({ error: 'This category already exists.' }));
              return;
            }
            const newCat = {
              id: cat.id || `cat_${Date.now()}`,
              storeId: cat.storeId || 'store_aura_main',
              name: cat.name.trim(),
              description: cat.description || '',
              iconName: cat.iconName || 'Package',
              imageUrl: cat.imageUrl || '',
              color: cat.color || '#2563EB',
              sortOrder: cat.sortOrder || categories.length + 1,
              active: cat.active !== undefined ? cat.active : true,
              parentId: cat.parentId || null,
              printerId: cat.printerId || null,
              autoPrintKitchen: cat.autoPrintKitchen !== undefined ? cat.autoPrintKitchen : true,
              defaultLocale: cat.defaultLocale || 'en',
              createdAt: cat.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            categories.push(newCat);
            if (parsedBody.translations) {
              for (const [locale, tData] of Object.entries(parsedBody.translations as any)) {
                categoryTranslations.push({
                  id: `trans_${newCat.id}_${locale}`,
                  categoryId: newCat.id,
                  locale,
                  name: (tData as any).name,
                  description: (tData as any).description
                });
              }
            }
            res.statusCode = 201;
            res.end(JSON.stringify(newCat));
            return;
          }

          // Sub-routes under /api/v1/categories/:id
          const parts = pathname.replace('/api/v1/categories/', '').split('/');
          const id = decodeURIComponent(parts[0]);
          const subAction = parts[1];
          const subParam = parts[2];

          // 4. GET /api/v1/categories/:id/products
          if (subAction === 'products' && method === 'GET') {
            const catProducts = products.filter(p => p.categoryId === id);
            res.statusCode = 200;
            res.end(JSON.stringify(catProducts));
            return;
          }

          // 5. POST /api/v1/categories/:id/translations
          if (subAction === 'translations' && method === 'POST') {
            const { locale, name, description } = parsedBody;
            const existingIdx = categoryTranslations.findIndex(t => t.categoryId === id && t.locale === locale);
            const tr = {
              id: `trans_${id}_${locale}`,
              categoryId: id,
              locale,
              name,
              description,
              updatedAt: new Date().toISOString()
            };
            if (existingIdx !== -1) {
              categoryTranslations[existingIdx] = tr;
            } else {
              categoryTranslations.push(tr);
            }
            res.statusCode = 200;
            res.end(JSON.stringify(tr));
            return;
          }

          // 6. PUT /api/v1/categories/:id/translations/:locale
          if (subAction === 'translations' && subParam && method === 'PUT') {
            const locale = subParam;
            const { name, description } = parsedBody;
            const existingIdx = categoryTranslations.findIndex(t => t.categoryId === id && t.locale === locale);
            const tr = {
              id: `trans_${id}_${locale}`,
              categoryId: id,
              locale,
              name,
              description,
              updatedAt: new Date().toISOString()
            };
            if (existingIdx !== -1) {
              categoryTranslations[existingIdx] = tr;
            } else {
              categoryTranslations.push(tr);
            }
            res.statusCode = 200;
            res.end(JSON.stringify(tr));
            return;
          }

          // 7. PATCH /api/v1/categories/:id/status
          if (subAction === 'status' && method === 'PATCH') {
            const cat = categories.find(c => c.id === id);
            if (!cat) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Category not found' }));
              return;
            }
            cat.active = !!parsedBody.active;
            cat.updatedAt = new Date().toISOString();
            res.statusCode = 200;
            res.end(JSON.stringify(cat));
            return;
          }

          // 8. GET /api/v1/categories/:id
          if (!subAction && method === 'GET') {
            const cat = categories.find(c => c.id === id);
            if (!cat) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Category not found' }));
              return;
            }
            res.statusCode = 200;
            res.end(JSON.stringify(cat));
            return;
          }

          // 9. PUT /api/v1/categories/:id
          if (!subAction && method === 'PUT') {
            const catIdx = categories.findIndex(c => c.id === id);
            if (catIdx === -1) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Category not found' }));
              return;
            }
            const cat = parsedBody.category || parsedBody;
            if (cat.name && !cat.name.trim()) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Category name is required.' }));
              return;
            }
            if (cat.name) {
              const duplicate = categories.find(
                c => c.name.trim().toLowerCase() === cat.name.trim().toLowerCase() && c.id !== id
              );
              if (duplicate) {
                res.statusCode = 409;
                res.end(JSON.stringify({ error: 'This category already exists.' }));
                return;
              }
            }
            categories[catIdx] = {
              ...categories[catIdx],
              ...cat,
              updatedAt: new Date().toISOString()
            };
            res.statusCode = 200;
            res.end(JSON.stringify(categories[catIdx]));
            return;
          }

          // 10. DELETE /api/v1/categories/:id
          if (!subAction && method === 'DELETE') {
            const destCatId = urlObj.searchParams.get('destinationCategoryId');
            if (destCatId) {
              products.forEach(p => {
                if (p.categoryId === id) p.categoryId = destCatId;
              });
            }
            categories = categories.filter(c => c.id !== id);
            categoryTranslations = categoryTranslations.filter(t => t.categoryId !== id);
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true }));
            return;
          }

          next();
        });
      });
    }
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), printerBridgePlugin(), categoryApiPlugin(), menuScannerPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
