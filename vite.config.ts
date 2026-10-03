import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import net from 'net';

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
    plugins: [react(), tailwindcss(), printerBridgePlugin(), categoryApiPlugin()],
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
