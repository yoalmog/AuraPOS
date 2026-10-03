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

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), printerBridgePlugin()],
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
