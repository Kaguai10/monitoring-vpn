import db, {
  upsertPeer,
  updatePeerStatus,
  logConnectionEvent,
  logDnsQuery,
  logBandwidthSample,
  createNotification,
  getSetting,
  setSetting,
} from '../db.js';
import { isDomainBlocked } from '../utils/blocked-dns.js';
import { checkAiDomain } from '../utils/ai-dns.js';

/**
 * Demo Service - menghasilkan data mock yang realistis.
 *
 * Berjalan ketika WireGuard tidak tersedia (misal di Windows / development).
 * Mensimulasikan:
 *  - User VPN connect/disconnect
 *  - DNS queries (normal, blocked, AI)
 *  - Bandwidth fluctuations
 *  - Notifikasi
 */

const DEMO_USERS = [
  { name: 'Client 01', email: 'client01@example.invalid', ip: '10.0.0.2' },
  { name: 'Client 02', email: 'client02@example.invalid', ip: '10.0.0.3' },
  { name: 'Client 03', email: 'client03@example.invalid', ip: '10.0.0.4' },
  { name: 'Client 04', email: 'client04@example.invalid', ip: '10.0.0.5' },
  { name: 'Client 05', email: 'client05@example.invalid', ip: '10.0.0.6' },
  { name: 'Client 06', email: 'client06@example.invalid', ip: '10.0.0.7' },
  { name: 'Client 07', email: 'client07@example.invalid', ip: '10.0.0.8' },
  { name: 'Client 08', email: 'client08@example.invalid', ip: '10.0.0.9' },
  { name: 'Client 09', email: 'client09@example.invalid', ip: '10.0.0.10' },
  { name: 'Client 10', email: 'client10@example.invalid', ip: '10.0.0.11' },
  { name: 'Client 11', email: 'client11@example.invalid', ip: '10.0.0.12' },
  { name: 'Client 12', email: 'client12@example.invalid', ip: '10.0.0.13' },
];

// Domain pool untuk simulasi DNS queries
const NORMAL_DNS = [
  'github.com', 'stackoverflow.com', 'google.com', 'cloudflare.com',
  'developer.mozilla.org', 'w3.org', 'ietf.org', 'rfc-editor.org',
  'npmjs.com', 'pypi.org', 'docker.com', 'ubuntu.com',
  'medium.com', 'dev.to', 'npmjs.com', 'pypi.org',
  'docker.com', 'kubernetes.io', 'linux.org', 'ubuntu.com',
  'wireshark.org', 'nmap.org', 'metasploit.com', 'burpsuite.com',
  'guru.google.com', 'docs.python.org', 'developer.mozilla.org',
  'w3.org', 'ietf.org', 'rfc-editor.org', 'shodan.io',
  'crt.sh', 'securitytrails.com', 'virustotal.com', 'abuseipdb.com',
  'gobuster.com', 'ffuf.com', 'hashcat.net', 'johntrk.com',
];

const BLOCKED_DNS_POOL = [
  'facebook.com', 'www.facebook.com', 'm.facebook.com',
  'instagram.com', 'www.instagram.com',
  'tiktok.com', 'www.tiktok.com',
  'youtube.com', 'www.youtube.com',
  'twitter.com', 'x.com',
  'netflix.com', 'www.netflix.com',
  'spotify.com',
  'reddit.com', 'www.reddit.com',
];

const AI_DNS_POOL = [
  { domain: 'chatgpt.com',          service: 'ChatGPT' },
  { domain: 'openai.com',           service: 'OpenAI / ChatGPT' },
  { domain: 'claude.ai',            service: 'Claude AI' },
  { domain: 'anthropic.com',        service: 'Anthropic / Claude' },
  { domain: 'gemini.google.com',     service: 'Google Gemini' },
  { domain: 'copilot.microsoft.com', service: 'Microsoft Copilot' },
  { domain: 'perplexity.ai',        service: 'Perplexity AI' },
  { domain: 'deepseek.com',         service: 'DeepSeek AI' },
  { domain: 'huggingface.co',       service: 'Hugging Face' },
];

let initialized = false;
let peerStates = {}; // ip -> { connected, handshakeTs, rxBytes, txBytes, connectTime }

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Inisialisasi data demo - seed peers dan history awal
 */
export function initDemoData() {
  if (initialized) return;
  initialized = true;

  const now = Math.floor(Date.now() / 1000);

  // Seed semua peers
  for (let i = 0; i < DEMO_USERS.length; i++) {
    const user = DEMO_USERS[i];
    const peer = {
      public_key: `demo-pub-key-${i + 1}`,
      name: user.name,
      email: user.email,
      ip_address: user.ip,
      endpoint: `203.0.113.${randomInt(10, 250)}:${randomInt(30000, 60000)}`,
      allowed_ips: `${user.ip}/32`,
    };
    upsertPeer(peer);

    // 8 user connected, 4 disconnected
    const isConnected = i < 8;
    const handshakeTs = isConnected ? now - randomInt(1, 30) : now - randomInt(300, 3600);

    const rxBytes = isConnected ? randomInt(500000, 50000000) : randomInt(100000, 5000000);
    const txBytes = isConnected ? randomInt(500000, 50000000) : randomInt(100000, 5000000);

    updatePeerStatus(user.ip, {
      is_connected: isConnected ? 1 : 0,
      last_handshake: isConnected ? new Date(handshakeTs * 1000).toISOString() : null,
      rx_bytes: rxBytes,
      tx_bytes: txBytes,
      prev_rx_bytes: rxBytes - randomInt(1000, 50000),
      prev_tx_bytes: txBytes - randomInt(1000, 50000),
      handshake_ts: handshakeTs,
      endpoint: peer.endpoint,
    });

    peerStates[user.ip] = {
      connected: isConnected,
      handshakeTs,
      rxBytes,
      txBytes,
      connectTime: now - randomInt(60, 3600),
    };

    // Seed connection events
    if (isConnected) {
      logConnectionEvent({
        peer_ip: user.ip,
        peer_name: user.name,
        event_type: 'connect',
        duration: null,
        rx_bytes: 0,
        tx_bytes: 0,
      });
    } else {
      // User yang disconnected punya riwayat connect + disconnect
      logConnectionEvent({
        peer_ip: user.ip,
        peer_name: user.name,
        event_type: 'connect',
        duration: null,
        rx_bytes: 0,
        tx_bytes: 0,
      });
      logConnectionEvent({
        peer_ip: user.ip,
        peer_name: user.name,
        event_type: 'disconnect',
        duration: randomInt(300, 3600),
        rx_bytes: rxBytes,
        tx_bytes: txBytes,
      });
    }
  }

  // Seed DNS queries (beberapa jam terakhir)
  seedDnsHistory();

  // Seed bandwidth samples
  seedBandwidthHistory();

  // Seed notifications
  seedNotifications();

  console.log('[DEMO] Data demo berhasil diinisialisasi');
}

/**
 * Seed riwayat DNS queries untuk beberapa jam terakhir
 */
function seedDnsHistory() {
  const now = Math.floor(Date.now() / 1000);
  const totalQueries = randomInt(500, 800);

  for (let i = 0; i < totalQueries; i++) {
    const user = randomChoice(DEMO_USERS);
    const ts = new Date((now - randomInt(0, 14400)) * 1000).toISOString(); // 4 jam terakhir

    let domain, isBlocked = 0, isAi = 0, aiService = null;

    const roll = Math.random();
    if (roll < 0.08) {
      // 8% blocked
      domain = randomChoice(BLOCKED_DNS_POOL);
      isBlocked = isDomainBlocked(domain) ? 1 : 0;
    } else if (roll < 0.15) {
      // 7% AI
      const aiEntry = randomChoice(AI_DNS_POOL);
      domain = aiEntry.domain;
      isAi = 1;
      aiService = aiEntry.service;
    } else {
      domain = randomChoice(NORMAL_DNS);
    }

    logDnsQuery({
      peer_ip: user.ip,
      peer_name: user.name,
      domain,
      query_type: randomChoice(['A', 'AAAA', 'A', 'A', 'CNAME']),
      is_blocked: isBlocked,
      is_ai: isAi,
      ai_service: aiService,
    });
  }
}

/**
 * Seed bandwidth samples
 */
function seedBandwidthHistory() {
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 60; i++) {
    const ts = new Date((now - (60 - i) * 5) * 1000).toISOString();
    for (const user of DEMO_USERS.slice(0, 8)) {
      logBandwidthSample({
        peer_ip: user.ip,
        rx_bytes: randomInt(1000, 100000),
        tx_bytes: randomInt(1000, 100000),
        rx_rate: randomInt(1000, 500000),
        tx_rate: randomInt(1000, 500000),
      });
    }
  }
}

/**
 * Seed notifikasi awal
 */
function seedNotifications() {
  // Disconnect notification
  for (let i = 8; i < 12; i++) {
    const user = DEMO_USERS[i];
    createNotification({
      type: 'disconnect',
      peer_ip: user.ip,
      peer_name: user.name,
      message: `${user.name} (${user.ip}) terputus dari VPN`,
      severity: 'warning',
    });
  }

  // Blocked DNS notification
  createNotification({
    type: 'blocked_dns',
    peer_ip: DEMO_USERS[1].ip,
    peer_name: DEMO_USERS[1].name,
    message: `${DEMO_USERS[1].name} mencoba mengakses facebook.com (diblokir)`,
    severity: 'critical',
  });
  createNotification({
    type: 'blocked_dns',
    peer_ip: DEMO_USERS[4].ip,
    peer_name: DEMO_USERS[4].name,
    message: `${DEMO_USERS[4].name} mencoba mengakses tiktok.com (diblokir)`,
    severity: 'critical',
  });

  // AI access notification
  createNotification({
    type: 'ai_access',
    peer_ip: DEMO_USERS[0].ip,
    peer_name: DEMO_USERS[0].name,
    message: `${DEMO_USERS[0].name} mengakses ChatGPT (chatgpt.com)`,
    severity: 'info',
  });
  createNotification({
    type: 'ai_access',
    peer_ip: DEMO_USERS[3].ip,
    peer_name: DEMO_USERS[3].name,
    message: `${DEMO_USERS[3].name} mengakses Claude AI (claude.ai)`,
    severity: 'info',
  });
}

/**
 * Simulasi tick - dipanggil setiap interval polling.
 * Mensimulasikan aktivitas real-time.
 */
export function demoTick() {
  const now = Math.floor(Date.now() / 1000);

  for (const user of DEMO_USERS) {
    const state = peerStates[user.ip];
    if (!state) continue;

    if (state.connected) {
      // Update transfer stats
      const rxIncrease = randomInt(500, 50000);
      const txIncrease = randomInt(500, 50000);
      state.rxBytes += rxIncrease;
      state.txBytes += txIncrease;
      state.handshakeTs = now - randomInt(1, 15);

      // Random chance disconnect (5%)
      if (Math.random() < 0.02) {
        state.connected = false;
        updatePeerStatus(user.ip, {
          is_connected: 0,
          last_handshake: null,
          rx_bytes: state.rxBytes,
          tx_bytes: state.txBytes,
          prev_rx_bytes: state.rxBytes - rxIncrease,
          prev_tx_bytes: state.txBytes - txIncrease,
          handshake_ts: 0,
          endpoint: null,
        });
        const duration = now - state.connectTime;
        logConnectionEvent({
          peer_ip: user.ip,
          peer_name: user.name,
          event_type: 'disconnect',
          duration,
          rx_bytes: state.rxBytes,
          tx_bytes: state.txBytes,
        });
        createNotification({
          type: 'disconnect',
          peer_ip: user.ip,
          peer_name: user.name,
          message: `${user.name} (${user.ip}) terputus dari VPN setelah ${Math.floor(duration / 60)}m ${duration % 60}s`,
          severity: 'warning',
        });
        continue;
      }

      updatePeerStatus(user.ip, {
        is_connected: 1,
        last_handshake: new Date(state.handshakeTs * 1000).toISOString(),
        rx_bytes: state.rxBytes,
        tx_bytes: state.txBytes,
        prev_rx_bytes: state.rxBytes - rxIncrease,
        prev_tx_bytes: state.txBytes - txIncrease,
        handshake_ts: state.handshakeTs,
        endpoint: null,
      });

      // Log bandwidth sample
      logBandwidthSample({
        peer_ip: user.ip,
        rx_bytes: state.rxBytes,
        tx_bytes: state.txBytes,
        rx_rate: rxIncrease,
        tx_rate: txIncrease,
      });

      // Generate DNS queries
      if (Math.random() < 0.4) {
        generateDemoDnsQuery(user, now);
      }
    } else {
      // Random chance reconnect (10%)
      if (Math.random() < 0.05) {
        state.connected = true;
        state.connectTime = now;
        state.handshakeTs = now;
        state.rxBytes = randomInt(0, 1000);
        state.txBytes = randomInt(0, 1000);
        updatePeerStatus(user.ip, {
          is_connected: 1,
          last_handshake: new Date(now * 1000).toISOString(),
          rx_bytes: state.rxBytes,
          tx_bytes: state.txBytes,
          prev_rx_bytes: 0,
          prev_tx_bytes: 0,
          handshake_ts: now,
          endpoint: `203.0.113.${randomInt(10, 250)}:${randomInt(30000, 60000)}`,
        });
        logConnectionEvent({
          peer_ip: user.ip,
          peer_name: user.name,
          event_type: 'connect',
          duration: null,
          rx_bytes: 0,
          tx_bytes: 0,
        });
      }
    }
  }
}

/**
 * Generate satu DNS query untuk user demo
 */
function generateDemoDnsQuery(user, now) {
  let domain, isBlocked = 0, isAi = 0, aiService = null;

  const roll = Math.random();
  if (roll < 0.05) {
    domain = randomChoice(BLOCKED_DNS_POOL);
    isBlocked = 1;
    createNotification({
      type: 'blocked_dns',
      peer_ip: user.ip,
      peer_name: user.name,
      message: `${user.name} mencoba mengakses ${domain} (diblokir)`,
      severity: 'critical',
    });
  } else if (roll < 0.08) {
    const aiEntry = randomChoice(AI_DNS_POOL);
    domain = aiEntry.domain;
    isAi = 1;
    aiService = aiEntry.service;
    createNotification({
      type: 'ai_access',
      peer_ip: user.ip,
      peer_name: user.name,
      message: `${user.name} mengakses ${aiService} (${domain})`,
      severity: 'info',
    });
  } else {
    domain = randomChoice(NORMAL_DNS);
  }

  logDnsQuery({
    peer_ip: user.ip,
    peer_name: user.name,
    domain,
    query_type: randomChoice(['A', 'AAAA', 'A', 'A', 'CNAME']),
    is_blocked: isBlocked,
    is_ai: isAi,
    ai_service: aiService,
  });
}

export default { initDemoData, demoTick };
