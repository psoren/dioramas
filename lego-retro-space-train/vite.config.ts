import { defineConfig } from 'vite';
import fs from 'node:fs';

// Dev-only plugin: receive browser console.log/warn/error POSTs and
// append them to /tmp/sim-console.log so a CLI agent can `tail` it
// without needing to drive the browser.
function browserConsolePipe() {
  const logPath = '/tmp/sim-console.log';
  return {
    name: 'browser-console-pipe',
    configureServer(server: import('vite').ViteDevServer) {
      // Truncate on dev-server start so the file reflects the current session.
      try { fs.writeFileSync(logPath, ''); } catch { /* noop */ }
      server.middlewares.use('/__sim_log', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const { level, msg } = JSON.parse(body);
            const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
            fs.appendFileSync(logPath, line);
          } catch { /* noop */ }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [browserConsolePipe()],
  server: {
    port: 5173,
    open: true,
    // Bind on all interfaces so Tailscale + LAN can hit the dev server.
    // Without this, vite defaults to localhost and *.ts.net URLs don't
    // resolve.
    host: true,
    // Allow LAN previews via Bonjour (`*.local`) and direct LAN/Tailscale IPs.
    allowedHosts: ['.local', '.lan', '.ts.net'],
  },
});
