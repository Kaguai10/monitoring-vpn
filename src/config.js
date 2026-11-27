import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

dotenv.config();

function parseBool(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return false;
}

/**
 * Deteksi otomatis demo mode:
 * - Jika DEMO_MODE=true  -> paksa demo
 * - Jika DEMO_MODE=false -> paksa real
 * - Jika DEMO_MODE=auto  -> coba jalankan `wg show`, jika gagal -> demo
 */
function autoDetectDemoMode() {
  const env = process.env.DEMO_MODE;
  if (env === 'true') return true;
  if (env === 'false') return false;
  // auto-detect
  try {
    execSync('wg show', { stdio: 'ignore', timeout: 3000 });
    return false;
  } catch {
    return true;
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || null,
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  adminUsername: process.env.ADMIN_USERNAME || 'administrator',
  adminPassword: process.env.ADMIN_PASSWORD || null,

  // WireGuard
  wgInterface: process.env.WG_INTERFACE || 'wg0',
  wgConfigPath: process.env.WG_CONFIG_PATH || '/etc/wireguard/wg0.conf',

  // dnsmasq
  dnsmasqLogPath: process.env.DNSMASQ_LOG_PATH || '/var/log/dnsmasq.log',
  dnsmasqBlockedConfigPath: process.env.DNSMASQ_BLOCKED_CONFIG_PATH || '/var/lib/webvpn/blocked-services.conf',
  vpnInternetAccessFilePath: process.env.VPN_INTERNET_ACCESS_FILE_PATH || '/var/lib/webvpn/internet-access.enabled',

  // Monitor
  pollInterval: parseInt(process.env.POLL_INTERVAL || '5000', 10),
  dnsPollInterval: parseInt(process.env.DNS_POLL_INTERVAL || '2000', 10),
  disconnectTimeout: parseInt(process.env.DISCONNECT_TIMEOUT || '120', 10),
  dataRetentionHours: parseInt(process.env.DATA_RETENTION_HOURS || '168', 10),

  // Demo
  demoMode: autoDetectDemoMode(),

  // Reset
  resetKey: process.env.RESET_KEY || randomBytes(24).toString('hex'),
};

export default config;
