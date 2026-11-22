import { Router } from 'express';
import db, {
  updatePeerInfo,
  markNotificationRead,
  markAllNotificationsRead,
  getSetting,
  setSetting,
  resetAllData,
} from '../db.js';
import { calculateConnectionStrength, startMonitor, stopMonitor, isMonitorRunning } from '../services/monitor.js';
import { BLOCKED_DNS } from '../utils/blocked-dns.js';
import { AI_DNS } from '../utils/ai-dns.js';
import { writeDnsmasqBlocklist } from '../services/dns-blocklist.js';
import { writeVpnInternetAccessState } from '../services/vpn-access.js';
import config from '../config.js';
import { getUserByIp } from '../services/user-directory.js';

const router = Router();

// Helper: format bytes ke human readable
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper: format durasi detik ke human readable
function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}j ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// SQLite datetime('now') menghasilkan UTC tanpa suffix zona waktu.
function parseTimestamp(timestamp) {
  if (!timestamp) return NaN;
  const value = typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(timestamp)
    ? `${timestamp.replace(' ', 'T')}Z`
    : timestamp;
  return new Date(value).getTime();
}

// Helper: waktu relatif
function timeAgo(timestamp) {
  if (!timestamp) return '-';
  const diff = Date.now() - parseTimestamp(timestamp);
  if (!Number.isFinite(diff) || diff <= 5000) return 'baru saja';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds} detik lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

// ============================================================
// DASHBOARD API
// ============================================================

router.get('/dashboard', (req, res) => {
  const totalPeers = db.prepare('SELECT COUNT(*) as count FROM vpn_peers').get().count;
  const connectedPeers = db.prepare('SELECT COUNT(*) as count FROM vpn_peers WHERE is_connected = 1').get().count;
  const disconnectedPeers = totalPeers - connectedPeers;

  // Average connection strength
  const connectedPeerData = db.prepare('SELECT ip_address, handshake_ts, rx_bytes, tx_bytes FROM vpn_peers WHERE is_connected = 1').all();
  let avgStrength = 0;
  if (connectedPeerData.length > 0) {
    const strengths = connectedPeerData.map(p => calculateConnectionStrength(p.handshake_ts, p.rx_bytes, p.tx_bytes));
    avgStrength = Math.round(strengths.reduce((a, b) => a + b, 0) / strengths.length);
  }

  // DNS traffic timeline (per menit, 1 jam terakhir)
  const dnsTimeline = db.prepare(`
    SELECT strftime('%H:%M', timestamp, '+7 hours') as time_label, COUNT(*) as count
    FROM dns_queries
    WHERE timestamp > datetime('now', '-1 hour')
    GROUP BY time_label
    ORDER BY time_label
  `).all();

  // Top 5 DNS
  const topDns = db.prepare(`
    SELECT domain, COUNT(*) as count
    FROM dns_queries
    WHERE timestamp > datetime('now', '-24 hours')
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 5
  `).all();

  // DNS stats today
  const dnsTotalToday = db.prepare("SELECT COUNT(*) as count FROM dns_queries WHERE date(timestamp, '+7 hours') = date('now', '+7 hours')").get().count;
  const dnsBlockedToday = db.prepare("SELECT COUNT(*) as count FROM dns_queries WHERE date(timestamp, '+7 hours') = date('now', '+7 hours') AND is_blocked = 1").get().count;
  const dnsAiToday = db.prepare("SELECT COUNT(*) as count FROM dns_queries WHERE date(timestamp, '+7 hours') = date('now', '+7 hours') AND is_ai = 1").get().count;

  // Total traffic
  const totalTraffic = db.prepare('SELECT SUM(rx_bytes) as rx, SUM(tx_bytes) as tx FROM vpn_peers').get();
  const totalRx = totalTraffic.rx || 0;
  const totalTx = totalTraffic.tx || 0;

  res.json({
    totalPeers,
    connectedPeers,
    disconnectedPeers,
    avgStrength,
    dnsTimeline,
    topDns,
    dnsTotalToday,
    dnsBlockedToday,
    dnsAiToday,
    totalRx,
    totalTx,
    totalRxFormatted: formatBytes(totalRx),
    totalTxFormatted: formatBytes(totalTx),
  });
});

// ============================================================
// USERS API
// ============================================================

router.get('/users', (req, res) => {
  const peers = db.prepare(`
    SELECT ip_address, name, email, endpoint, is_connected,
           last_handshake, handshake_ts, rx_bytes, tx_bytes,
           first_seen, updated_at
    FROM vpn_peers
    ORDER BY is_connected DESC, name ASC
  `).all();

  const result = peers.map(p => ({
    ...p,
    ...(getUserByIp(p.ip_address) || {}),
    strength: calculateConnectionStrength(p.handshake_ts, p.rx_bytes, p.tx_bytes),
    rxFormatted: formatBytes(p.rx_bytes),
    txFormatted: formatBytes(p.tx_bytes),
    lastHandshakeAgo: timeAgo(p.last_handshake),
  }));

  result.sort((a, b) => b.is_connected - a.is_connected || (a.name || '').localeCompare(b.name || ''));
  res.json({ users: result, total: result.length, connected: result.filter(u => u.is_connected).length });
});

// User detail + stats
router.get('/users/:ip', (req, res) => {
  const { ip } = req.params;

  const storedPeer = db.prepare('SELECT * FROM vpn_peers WHERE ip_address = ?').get(ip);
  const peer = storedPeer && { ...storedPeer, ...(getUserByIp(ip) || {}) };
  if (!peer) {
    return res.status(404).json({ error: 'User tidak ditemukan' });
  }

  // DNS counts
  const dnsTotal = db.prepare('SELECT COUNT(*) as count FROM dns_query_events WHERE peer_ip = ?').get(ip).count;
  const dnsBlocked = db.prepare('SELECT COUNT(*) as count FROM dns_query_events WHERE peer_ip = ? AND is_blocked = 1').get(ip).count;
  const dnsAi = db.prepare('SELECT COUNT(*) as count FROM dns_query_events WHERE peer_ip = ? AND is_ai = 1').get(ip).count;
  const dnsNormal = dnsTotal - dnsBlocked - dnsAi;

  // Connection success rate
  const events = db.prepare('SELECT * FROM connection_events WHERE peer_ip = ? ORDER BY timestamp ASC').all(ip);
  let totalConnectedTime = 0;
  let connectTime = null;

  for (const event of events) {
    if (event.event_type === 'connect') {
      connectTime = parseTimestamp(event.timestamp);
    } else if (event.event_type === 'disconnect') {
      if (event.duration) {
        totalConnectedTime += event.duration;
      } else if (connectTime) {
        totalConnectedTime += (parseTimestamp(event.timestamp) - connectTime) / 1000;
      }
      connectTime = null;
    }
  }

  // Current session if connected
  if (peer.is_connected && connectTime) {
    totalConnectedTime += (Date.now() - connectTime) / 1000;
  }

  const totalTime = peer.first_seen ? (Date.now() - parseTimestamp(peer.first_seen)) / 1000 : 0;
  const connectionSuccessRate = totalTime > 0 ? Math.min(100, Math.round((totalConnectedTime / totalTime) * 100)) : 0;

  // DNS timeline for this user (per menit, 1 jam terakhir)
  const dnsTimeline = db.prepare(`
    SELECT strftime('%H:%M', timestamp, '+7 hours') as time_label, COUNT(*) as count
    FROM dns_query_events
    WHERE peer_ip = ? AND timestamp > datetime('now', '-1 hour')
    GROUP BY time_label
    ORDER BY time_label
  `).all(ip);

  // Bandwidth samples (traffic chart)
  const bandwidth = db.prepare(`
    SELECT timestamp, rx_rate, tx_rate, rx_bytes, tx_bytes
    FROM bandwidth_samples
    WHERE peer_ip = ?
    ORDER BY timestamp DESC
    LIMIT 30
  `).all(ip).reverse();

  res.json({
    peer: {
      ...peer,
      strength: calculateConnectionStrength(peer.handshake_ts, peer.rx_bytes, peer.tx_bytes),
      rxFormatted: formatBytes(peer.rx_bytes),
      txFormatted: formatBytes(peer.tx_bytes),
      lastHandshakeAgo: timeAgo(peer.last_handshake),
    },
    stats: {
      dnsTotal,
      dnsBlocked,
      dnsAi,
      dnsNormal,
      connectionSuccessRate,
      totalConnectedTime: formatDuration(totalConnectedTime),
      totalConnectedSeconds: totalConnectedTime,
    },
    dnsTimeline,
    bandwidth: bandwidth.map(b => ({
      ...b,
      rxRateFormatted: formatBytes(b.rx_rate) + '/s',
      txRateFormatted: formatBytes(b.tx_rate) + '/s',
    })),
  });
});

// User DNS queries list
router.get('/users/:ip/dns', (req, res) => {
  const { ip } = req.params;
  const { type = 'all', limit = 100, offset = 0 } = req.query;
  const limitNum = Math.min(parseInt(limit, 10) || 100, 500);
  const offsetNum = parseInt(offset, 10) || 0;

  let query = `
    SELECT domain, query_type, is_blocked, is_ai, ai_service, timestamp
    FROM dns_query_events
    WHERE peer_ip = ?
  `;
  const queryParams = [ip];

  if (type === 'blocked') { query += ' AND is_blocked = 1'; }
  else if (type === 'ai') { query += ' AND is_ai = 1'; }
  else if (type === 'normal') { query += ' AND is_blocked = 0 AND is_ai = 0'; }

  query += ' ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?';
  queryParams.push(limitNum, offsetNum);

  const results = db.prepare(query).all(...queryParams);

  let countQuery = 'SELECT COUNT(*) as count FROM dns_query_events WHERE peer_ip = ?';
  if (type === 'blocked') countQuery += ' AND is_blocked = 1';
  else if (type === 'ai') countQuery += ' AND is_ai = 1';
  else if (type === 'normal') countQuery += ' AND is_blocked = 0 AND is_ai = 0';

  const totalCount = db.prepare(countQuery).get(ip).count;

  res.json({
    queries: results.map(q => ({
      ...q,
      timeAgo: timeAgo(q.timestamp),
    })),
    total: totalCount,
    limit: limitNum,
    offset: offsetNum,
  });
});

// User connection history
router.get('/users/:ip/connections', (req, res) => {
  const { ip } = req.params;
  const events = db.prepare(`
    SELECT * FROM connection_events
    WHERE peer_ip = ?
    ORDER BY timestamp DESC
    LIMIT 50
  `).all(ip);

  res.json({
    events: events.map(e => ({
      ...e,
      durationFormatted: e.duration ? formatDuration(e.duration) : null,
      rxFormatted: formatBytes(e.rx_bytes),
      txFormatted: formatBytes(e.tx_bytes),
      timeAgo: timeAgo(e.timestamp),
    })),
  });
});

// Update user info (name, email)
router.patch('/users/:ip', (req, res) => {
  const { ip } = req.params;
  const { name, email } = req.body;

  const peer = db.prepare('SELECT * FROM vpn_peers WHERE ip_address = ?').get(ip);
  if (!peer) {
    return res.status(404).json({ error: 'User tidak ditemukan' });
  }

  updatePeerInfo(ip, name || peer.name, email || peer.email);
  res.json({ success: true, message: 'Info user berhasil diupdate' });
});

// ============================================================
// NOTIFICATIONS API
// ============================================================

router.get('/notifications', (req, res) => {
  const { type = 'all', limit = 100, unreadOnly = 'false' } = req.query;
  const limitNum = Math.min(parseInt(limit, 10) || 100, 500);

  let query = 'SELECT * FROM notifications';
  const params = [];
  const conditions = [];

  if (type !== 'all') {
    conditions.push('type = ?');
    params.push(type);
  }
  if (unreadOnly === 'true') {
    conditions.push('is_read = 0');
  }
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  // Multiple notifications can be created in the same second. Use the
  // monotonically increasing id as a tie-breaker so the newest rows are
  // always returned first (and the page does not appear to omit recent data).
  query += ' ORDER BY timestamp DESC, id DESC LIMIT ?';
  params.push(limitNum);

  const notifications = db.prepare(query).all(...params);

  res.json({
    notifications: notifications.map(n => {
      // Older/imported notification rows may not have a peer or may contain
      // a non-text message. Keep those rows readable instead of failing the
      // entire list response while enriching names from the user directory.
      const peerIp = typeof n.peer_ip === 'string' ? n.peer_ip : '';
      const directoryUser = peerIp ? getUserByIp(peerIp) : null;
      const rawMessage = typeof n.message === 'string' ? n.message : String(n.message ?? '');
      const peerName = directoryUser?.name || n.peer_name || null;
      const message = directoryUser && peerIp && rawMessage.includes(peerIp)
        ? rawMessage.split(peerIp).join(directoryUser.name)
        : rawMessage;
      return {
        ...n,
        peer_name: peerName,
        message,
        timeAgo: timeAgo(n.timestamp),
      };
    }),
    total: notifications.length,
  });
});

router.get('/notifications/unread-count', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0').get().count;
  res.json({ count });
});

router.patch('/notifications/:id/read', (req, res) => {
  const { id } = req.params;
  markNotificationRead(parseInt(id, 10));
  res.json({ success: true });
});

router.patch('/notifications/read-all', (req, res) => {
  markAllNotificationsRead();
  res.json({ success: true });
});

// ============================================================
// DNS API
// ============================================================

router.get('/dns/top', (req, res) => {
  const { limit = 10, hours = 24 } = req.query;
  const limitNum = Math.min(parseInt(limit, 10) || 10, 50);
  const hoursNum = parseInt(hours, 10) || 24;

  const topDns = db.prepare(`
    SELECT domain, COUNT(*) as count,
      SUM(is_blocked) as blocked_count,
      SUM(is_ai) as ai_count
    FROM dns_queries
    WHERE timestamp > datetime('now', ?)
    GROUP BY domain
    ORDER BY count DESC
    LIMIT ?
  `).all(`-${hoursNum} hours`, limitNum);

  res.json({ topDns });
});

router.get('/dns/recent', (req, res) => {
  const { limit = 50 } = req.query;
  const limitNum = Math.min(parseInt(limit, 10) || 50, 200);

  const recent = db.prepare(`
    SELECT d.domain, d.query_type, d.is_blocked, d.is_ai, d.ai_service,
           d.peer_ip, d.peer_name, d.timestamp
    FROM dns_queries d
    ORDER BY d.timestamp DESC
    LIMIT ?
  `).all(limitNum);

  res.json({
    queries: recent.map(q => ({
      ...q,
      timeAgo: timeAgo(q.timestamp),
    })),
  });
});

// ============================================================
// SETTINGS API
// ============================================================

router.get('/settings', (req, res) => {
  const blockedList = getSetting('blocked_dns_list', JSON.stringify(BLOCKED_DNS));
  const aiList = getSetting('ai_dns_list', JSON.stringify(AI_DNS));

  res.json({
    blockedDnsList: JSON.parse(blockedList),
    aiDnsList: JSON.parse(aiList),
    aiBlockingEnabled: getSetting('ai_blocking_enabled', 'true') === 'true',
    vpnInternetAccessEnabled: getSetting('vpn_internet_access_enabled', 'true') === 'true',
    config: {
      wgInterface: config.wgInterface,
      pollInterval: config.pollInterval,
      dnsPollInterval: config.dnsPollInterval,
      disconnectTimeout: config.disconnectTimeout,
      dataRetentionHours: config.dataRetentionHours,
      demoMode: config.demoMode,
    },
  });
});

router.put('/settings', (req, res) => {
  const { blockedDnsList, aiDnsList, aiBlockingEnabled, vpnInternetAccessEnabled } = req.body;

  if (blockedDnsList) {
    if (!Array.isArray(blockedDnsList)) {
      return res.status(400).json({ error: 'blockedDnsList harus berupa array' });
    }
    if (!blockedDnsList.every(domain => typeof domain === 'string')) {
      return res.status(400).json({ error: 'Setiap domain harus berupa teks' });
    }
    setSetting('blocked_dns_list', JSON.stringify(blockedDnsList));
  }

  if (aiDnsList) {
    if (!Array.isArray(aiDnsList)) {
      return res.status(400).json({ error: 'aiDnsList harus berupa array' });
    }
    if (!aiDnsList.every(entry => typeof entry === 'string' || (entry && typeof entry.domain === 'string'))) {
      return res.status(400).json({ error: 'Format aiDnsList tidak valid' });
    }
    setSetting('ai_dns_list', JSON.stringify(aiDnsList));
  }

  if (typeof aiBlockingEnabled === 'boolean') setSetting('ai_blocking_enabled', String(aiBlockingEnabled));
  if (typeof vpnInternetAccessEnabled === 'boolean') setSetting('vpn_internet_access_enabled', String(vpnInternetAccessEnabled));

  if (blockedDnsList !== undefined || aiDnsList !== undefined || aiBlockingEnabled !== undefined) {
    try {
      writeDnsmasqBlocklist();
    } catch (error) {
      console.error('[DNS] Gagal menerapkan konfigurasi dnsmasq:', error);
      return res.status(500).json({ error: 'Daftar tersimpan, tetapi konfigurasi dnsmasq gagal diterapkan' });
    }
  }

  if (typeof vpnInternetAccessEnabled === 'boolean') {
    try {
      writeVpnInternetAccessState();
    } catch (error) {
      console.error('[VPN] Gagal menerapkan pengaturan akses internet:', error);
      return res.status(500).json({ error: 'Pengaturan tersimpan, tetapi firewall gagal diperbarui' });
    }
  }

  res.json({ success: true, message: 'Settings berhasil diupdate' });
});

// ============================================================
// SYSTEM API
// ============================================================

router.get('/system', (req, res) => {
  const totalPeers = db.prepare('SELECT COUNT(*) as count FROM vpn_peers').get().count;
  const connectedPeers = db.prepare('SELECT COUNT(*) as count FROM vpn_peers WHERE is_connected = 1').get().count;
  const totalDnsQueries = db.prepare('SELECT COUNT(*) as count FROM dns_queries').get().count;
  const totalNotifications = db.prepare('SELECT COUNT(*) as count FROM notifications').get().count;
  const unreadNotifications = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0').get().count;

  res.json({
    totalPeers,
    connectedPeers,
    totalDnsQueries,
    totalNotifications,
    unreadNotifications,
    demoMode: config.demoMode,
    uptime: process.uptime(),
    nodeVersion: process.version,
  });
});

// ============================================================
// MONITOR CONTROL API
// ============================================================

router.get('/monitor/status', (req, res) => {
  res.json({ active: isMonitorRunning() });
});

router.post('/monitor/start', (req, res) => {
  if (isMonitorRunning()) {
    return res.json({ success: true, message: 'Monitoring sudah aktif' });
  }
  setSetting('monitor_active', 'true');
  startMonitor();
  res.json({ success: true, message: 'Monitoring dimulai' });
});

router.post('/monitor/stop', (req, res) => {
  if (!isMonitorRunning()) {
    return res.json({ success: true, message: 'Monitoring sudah berhenti' });
  }
  setSetting('monitor_active', 'false');
  stopMonitor();
  res.json({ success: true, message: 'Monitoring dihentikan' });
});

// ============================================================
// RESET API
// ============================================================

router.post('/reset', (req, res) => {
  try {
    resetAllData();
    res.json({ success: true, message: 'Semua data berhasil direset. Data VPN akan terisi otomatis dari WireGuard.' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal reset data: ' + err.message });
  }
});

export default router;
