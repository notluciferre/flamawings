/**
 * Proxy Manager - Rotates through proxy list for bot connections
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.currentIndex = 0;
    this.loadProxies();
  }

  loadProxies() {
    try {
      const proxyPath = path.join(__dirname, '..', 'proxy.txt');
      const content = fs.readFileSync(proxyPath, 'utf8');
      
      this.proxies = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(proxy => this.parseProxy(proxy))
        .filter(proxy => proxy !== null);
      
      console.log(`[ProxyManager] Loaded ${this.proxies.length} proxies`);
    } catch (err) {
      console.warn(`[ProxyManager] Failed to load proxies: ${err.message}`);
      this.proxies = [];
    }
  }

  parseProxy(proxyString) {
    try {
      let type = 'socks5'; // Default
      let cleaned = proxyString;
      
      // Detect proxy type from prefix
      if (proxyString.startsWith('http://')) {
        type = 'http';
        cleaned = proxyString.replace('http://', '');
      } else if (proxyString.startsWith('https://')) {
        type = 'http'; // HTTPS proxy still uses 'http' type
        cleaned = proxyString.replace('https://', '');
      } else if (proxyString.startsWith('socks5://')) {
        type = 'socks5';
        cleaned = proxyString.replace('socks5://', '');
      } else if (proxyString.startsWith('socks4://')) {
        type = 'socks4';
        cleaned = proxyString.replace('socks4://', '');
      }
      
      // Parse host:port
      const parts = cleaned.split(':');
      if (parts.length < 2) return null;
      
      const host = parts[0];
      const port = parseInt(parts[1]);
      
      if (!host || isNaN(port)) return null;
      
      return {
        host,
        port,
        type,
      };
    } catch (err) {
      return null;
    }
  }

  getNext() {
    if (this.proxies.length === 0) return null;
    
    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    
    return proxy;
  }

  getRandom() {
    if (this.proxies.length === 0) return null;
    
    const index = Math.floor(Math.random() * this.proxies.length);
    return this.proxies[index];
  }

  getCount() {
    return this.proxies.length;
  }
}

export default new ProxyManager();
