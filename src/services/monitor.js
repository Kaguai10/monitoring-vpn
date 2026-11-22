import db, {
  upsertPeer,
  updatePeerStatus,
  logConnectionEvent,
  logDnsQuery,
  logBandwidthSample,
  createNotification,
  cleanupOldData,
} from '../db.js';
import { getWireGuardPeers, getPeersFromConfig } from './wireguard.js';
import { readNewDnsQueriesSync } from './dnsmasq.js';
import { initDemoData, demoTick } from './demo.js';
import { isDomainBlocked } from '../utils/blocked-dns.js';
import { checkAiDomain } from '../utils/ai-dns.js';
import { getUserByIp } from './user-directory.js';
import config from '../config.js';

/**
 * Monitor Service - orchestrator utama.
 *
 * Menjalankan polling:
 *  1. WireGuard status setiap POLL_INTERVAL
 *  2. dnsmasq log setiap DNS_POLL_INTERVAL
 *
 * Dalam demo mode, menggunakan demo service.
 */

let monitorRunning = false;
let wgTimer = null;
let dnsTimer = null;
let cleanupTimer = null;

// Track state untuk deteksi connect/disconnect
let peerConnectionState = {}; // ip -> boolean (connected)
let wgEmptyWarned = false;    // suppress repeated "0 peer" warnings
let configFallbackUsed = false; // track if config-file fallback already ran

/**
 * Mulai monitoring
 */
export function startMonitor() {
  if (monitorRunning) return;
  monitorRunning = true;

  console.log(`[Monitor] Mode: ${config.demoMode ? 'DEMO' : 'REAL'}`);

  if (config.demoMode) {
    initDemoData();
    // Seed state koneksi
    db.prepare('SELECT ip_address, is_connected FROM vpn_peers').all().forEach(row => {
      peerConnectionState[row.ip_address] = row.is_connected === 1;
    });

    wgTimer = setInterval(() => {
      try {
        demoTick();
      } catch (e) {
        console.error('[Monitor] Demo tick error:', e.message);
      }
    }, config.pollInterval);

    // Demo: tidak perlu DNS timer terpisah, DNS di-generate di demoTick
  } else {
    // REAL MODE
    // Restore the last known state before polling, so a process restart does
    // not create synthetic connect events for peers that were already online.
    db.prepare('SELECT ip_address, is_connected FROM vpn_peers').all().forEach(row => {
      peerConnectionState[row.ip_address] = row.is_connected === 1;
    });

    // Initial poll
    pollWireGuard();

    wgTimer = setInterval(() => {
      try {
        pollWireGuard();
      } catch (e) {
        console.error('[Monitor] WireGuard poll error:', e.message);
      }
    }, config.pollInterval);

    dnsTimer = setInterval(() => {
      try {
        pollDnsmasq();
      } catch (e) {
        console.error('[Monitor] dnsmasq poll error:', e.message);
      }
    }, config.dnsPollInterval);
  }

  // Cleanup data lama setiap jam
  cleanupTimer = setInterval(() => {
    try {
      cleanupOldData();
      console.log('[Monitor] Data lama dibersihkan');
    } catch (e) {
      console.error('[Monitor] Cleanup error:', e.message);
    }
  }, 3600000);

  console.log(`[Monitor] Monitoring dimulai (WG: ${config.pollInterval}ms, DNS: ${config.dnsPollInterval}ms)`);
}

/**
 * Stop monitoring
 */
export function stopMonitor() {
  if (wgTimer) clearInterval(wgTimer);
  if (dnsTimer) clearInterval(dnsTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  wgTimer = null;
  dnsTimer = null;
  cleanupTimer = null;
  monitorRunning = false;
  console.log('[Monitor] Monitoring dihentikan');
}

/**
 * Cek apakah monitoring sedang berjalan
 */
export function isMonitorRunning() {
  return monitorRunning;
}

/**
 * Poll status WireGuard dan update database
 */
function pollWireGuard() {
  let peers = getWireGuardPeers();
  const now = Math.floor(Date.now() / 1000);

  // Fallback: jika wg show tidak mengembalikan peer, baca dari config file
  if (peers.length === 0) {
    if (!wgEmptyWarned) {
      console.warn(`[Monitor] WireGuard tidak mengembalikan peer. Pastikan interface "${config.wgInterface}" aktif dan dapat diakses (network_mode: host, cap_add: NET_ADMIN).`);
      wgEmptyWarned = true;
    }
    const configPeers = getPeersFromConfig();
    if (configPeers.length > 0 && !configFallbackUsed) {
      peers = configPeers;
      configFallbackUsed = true;
      console.warn(`[Monitor] Fallback: ${peers.length} peer dibaca dari config file. Status koneksi (online/offline) mungkin tidak akurat sampai "wg show" berfungsi.`);
    }
  } else {
    if (wgEmptyWarned) {
      console.log(`[Monitor] WireGuard kembali normal: ${peers.length} peer ditemukan.`);
      wgEmptyWarned = false;
    }
    configFallbackUsed = false;
  }

  for (const peer of peers) {
    const directoryUser = getUserByIp(peer.ipAddress);
    // Upsert peer info
    upsertPeer({
      public_key: peer.publicKey,
      name: directoryUser?.name || peer.name,
      email: directoryUser?.email || peer.email,
      ip_address: peer.ipAddress,
      endpoint: peer.endpoint,
      allowed_ips: peer.allowedIps,
    });

    // Tentukan status koneksi
    const handshakeAge = peer.handshakeTs > 0 ? now - peer.handshakeTs : 999999;
    const isConnected = handshakeAge < config.disconnectTimeout ? 1 : 0;
    const wasConnected = peerConnectionState[peer.ipAddress] || false;
    const handshakeTime = peer.handshakeTs > 0
      ? new Date(peer.handshakeTs * 1000).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    updatePeerStatus(peer.ipAddress, {
      is_connected: isConnected,
      last_handshake: peer.handshakeTs > 0 ? new Date(peer.handshakeTs * 1000).toISOString() : null,
      rx_bytes: peer.rxBytes,
      tx_bytes: peer.txBytes,
      prev_rx_bytes: peer.rxBytes,
      prev_tx_bytes: peer.txBytes,
      handshake_ts: peer.handshakeTs,
      endpoint: peer.endpoint,
    });

    // Deteksi perubahan status koneksi
    if (isConnected && !wasConnected) {
      // Connect event
      logConnectionEvent({
        peer_ip: peer.ipAddress,
        peer_name: peer.name,
        event_type: 'connect',
        timestamp: handshakeTime,
        duration: null,
        rx_bytes: peer.rxBytes,
        tx_bytes: peer.txBytes,
      });
      peerConnectionState[peer.ipAddress] = true;
      console.log(`[Monitor] ${peer.name || peer.ipAddress} terhubung`);
    } else if (!isConnected && wasConnected) {
      // Disconnect event
      const peerRow = db.prepare('SELECT name FROM vpn_peers WHERE ip_address = ?').get(peer.ipAddress);
      const peerName = peerRow?.name || peer.name || peer.ipAddress;

      logConnectionEvent({
        peer_ip: peer.ipAddress,
        peer_name: peerName,
        event_type: 'disconnect',
        timestamp: peer.handshakeTs > 0
          ? new Date((peer.handshakeTs + config.disconnectTimeout) * 1000).toISOString().slice(0, 19).replace('T', ' ')
          : null,
        duration: config.disconnectTimeout,
        rx_bytes: peer.rxBytes,
        tx_bytes: peer.txBytes,
      });
      createNotification({
        type: 'disconnect',
        peer_ip: peer.ipAddress,
        peer_name: peerName,
        message: `${peerName} (${peer.ipAddress}) terputus dari VPN`,
        severity: 'warning',
        timestamp: peer.handshakeTs > 0
          ? new Date((peer.handshakeTs + config.disconnectTimeout) * 1000).toISOString().slice(0, 19).replace('T', ' ')
          : null,
      });
      peerConnectionState[peer.ipAddress] = false;
      console.log(`[Monitor] ${peerName} terputus`);
    }
  }
}

/**
 * Ekstrak root domain dari subdomain.
 * Contoh: gateway.discord.com -> discord.com
 *         www.facebook.com -> facebook.com
 *         gemini.google.com -> google.com
 *         chatgpt.com -> chatgpt.com (sudah root)
 */
function extractRootDomain(domain) {
  const d = domain.toLowerCase().trim().replace(/\.$/, '');
  // Keep service-specific AI domains intact for useful reports and precise blocking.
  const aiService = checkAiDomain(d);
  if (aiService) return d;
  const parts = d.split('.');
  if (parts.length <= 2) return d;

  // Common two-part TLDs (co.uk, com.id, dll)
  const twoPartTlds = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
    'co.jp', 'co.kr', 'co.id', 'or.id', 'ac.id', 'or.jp',
    'com.au', 'net.au', 'org.au', 'co.nz',
    'com.br', 'com.mx', 'co.za',
    'com.sg', 'com.tw', 'co.in', 'net.in', 'org.in',
  ]);

  const lastTwo = parts.slice(-2).join('.');
  if (twoPartTlds.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

/**
 * Parse log dnsmasq dan catat DNS queries
 */
function pollDnsmasq() {
  const queries = readNewDnsQueriesSync();
  if (queries.length === 0) return;

  // Build map IP -> name untuk lookup cepat
  const peerMap = {};
  db.prepare('SELECT ip_address, name FROM vpn_peers').all().forEach(row => {
    peerMap[row.ip_address] = getUserByIp(row.ip_address)?.name || row.name;
  });

  for (const q of queries) {
    const peerName = peerMap[q.clientIp] || q.clientIp;
    const fullDomain = q.domain;
    const rootDomain = extractRootDomain(fullDomain);

    // Cek blocked/AI pada full domain (suffix match menangani subdomain)
    const blocked = isDomainBlocked(fullDomain) ? 1 : 0;
    const aiService = checkAiDomain(fullDomain);
    const isAi = aiService ? 1 : 0;

    // Simpan root domain (bukan subdomain) — upsert: update timestamp bila sudah ada
    logDnsQuery({
      peer_ip: q.clientIp,
      peer_name: peerName,
      domain: rootDomain,
      query_type: q.queryType,
      is_blocked: blocked,
      is_ai: isAi,
      ai_service: aiService,
      timestamp: q.timestamp,
      sourceKey: q.sourceKey,
    });

    // Buat notifikasi untuk blocked DNS dan AI access
    if (blocked) {
      createNotification({
        type: 'blocked_dns',
        peer_ip: q.clientIp,
        peer_name: peerName,
        message: `${peerName} mencoba mengakses ${rootDomain} (diblokir)`,
        severity: 'critical',
        timestamp: q.timestamp,
      });
    }

    if (isAi) {
      createNotification({
        type: 'ai_access',
        peer_ip: q.clientIp,
        peer_name: peerName,
        message: `${peerName} mengakses ${aiService} (${rootDomain})`,
        severity: 'info',
        timestamp: q.timestamp,
      });
    }
  }
}

/**
 * Hitung kekuatan koneksi (0-100) berdasarkan handshake age dan transfer
 */
export function calculateConnectionStrength(handshakeTs, rxBytes, txBytes) {
  if (!handshakeTs || handshakeTs === 0) return 0;

  const now = Math.floor(Date.now() / 1000);
  const handshakeAge = now - handshakeTs;

  // Skor berdasarkan handshake age
  let ageScore;
  if (handshakeAge < 10) ageScore = 100;
  else if (handshakeAge < 30) ageScore = 90;
  else if (handshakeAge < 60) ageScore = 70;
  else if (handshakeAge < 120) ageScore = 50;
  else if (handshakeAge < 300) ageScore = 30;
  else ageScore = 10;

  // Skor berdasarkan transfer (aktivitas)
  const totalTransfer = rxBytes + txBytes;
  let transferScore;
  if (totalTransfer > 10000000) transferScore = 100;
  else if (totalTransfer > 1000000) transferScore = 80;
  else if (totalTransfer > 100000) transferScore = 60;
  else if (totalTransfer > 10000) transferScore = 40;
  else transferScore = 20;

  return Math.round(ageScore * 0.7 + transferScore * 0.3);
}

export default { startMonitor, stopMonitor, isMonitorRunning, calculateConnectionStrength };
