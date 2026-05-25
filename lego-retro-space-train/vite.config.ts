import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    // Allow LAN previews via Bonjour (`*.local`) and direct LAN/Tailscale IPs.
    allowedHosts: ['.local', '.lan', '.ts.net'],
  },
});
