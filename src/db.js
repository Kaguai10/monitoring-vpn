import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { mkdirSync } from 'fs';
import config from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = config.dbPath ? resolve(config.dbPath) : join(dataDir, 'monitor.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

// Optimasi SQLite
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ============================================================
// SCHEMA
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vpn_peers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  public_key    TEXT UNIQUE,
  name          TEXT,
  email         TEXT,
  ip_address    TEXT UNIQUE NOT NULL,
  endpoint      TEXT,
  allowed_ips   TEXT,
  is_connected  INTEGER DEFAULT 0,
  first_seen    TEXT DEFAULT (datetime('now')),
  last_handshake TEXT,
  rx_bytes      INTEGER DEFAULT 0,
  tx_bytes      INTEGER DEFAULT 0,
  prev_rx_bytes INTEGER DEFAULT 0,
  prev_tx_bytes INTEGER DEFAULT 0,
  handshake_ts  INTEGER DEFAULT 0,
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS connection_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_ip     TEXT NOT NULL,
  peer_name   TEXT,
  event_type  TEXT NOT NULL,
  timestamp   TEXT DEFAULT (datetime('now')),
  duration    INTEGER,
  rx_bytes    INTEGER DEFAULT 0,
  tx_bytes    INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conn_events_ip ON connection_events(peer_ip);
CREATE INDEX IF NOT EXISTS idx_conn_events_ts ON connection_events(timestamp);

CREATE TABLE IF NOT EXISTS dns_queries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_ip     TEXT NOT NULL,
  peer_name   TEXT,
  domain      TEXT NOT NULL,
  query_type  TEXT,
  is_blocked  INTEGER DEFAULT 0,
  is_ai       INTEGER DEFAULT 0,
  ai_service  TEXT,
  timestamp   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dns_ip ON dns_queries(peer_ip);
CREATE INDEX IF NOT EXISTS idx_dns_ts ON dns_queries(timestamp);
CREATE INDEX IF NOT EXISTS idx_dns_domain ON dns_queries(domain);

-- Migration: deduplikasi dns_queries (satu entry per peer_ip + domain)
DELETE FROM dns_queries WHERE id NOT IN (
  SELECT MAX(id) FROM dns_queries GROUP BY peer_ip, domain
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dns_peer_domain ON dns_queries(peer_ip, domain);

-- Riwayat per event; dns_queries tetap menjadi ringkasan terbaru per peer/domain.
CREATE TABLE IF NOT EXISTS dns_query_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key  TEXT UNIQUE,
  peer_ip     TEXT NOT NULL,
  peer_name   TEXT,
  domain      TEXT NOT NULL,
  query_type  TEXT,
  is_blocked  INTEGER DEFAULT 0,
  is_ai       INTEGER DEFAULT 0,
  ai_service  TEXT,
  timestamp   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dns_events_peer_ts ON dns_query_events(peer_ip, timestamp);
CREATE INDEX IF NOT EXISTS idx_dns_events_flags_ts ON dns_query_events(is_blocked, is_ai, timestamp);

CREATE TABLE IF NOT EXISTS bandwidth_samples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_ip     TEXT NOT NULL,
  rx_bytes    INTEGER DEFAULT 0,
  tx_bytes    INTEGER DEFAULT 0,
  rx_rate     REAL DEFAULT 0,
  tx_rate     REAL DEFAULT 0,
  timestamp   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bw_ip ON bandwidth_samples(peer_ip);
CREATE INDEX IF NOT EXISTS idx_bw_ts ON bandwidth_samples(timestamp);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  peer_ip     TEXT,
  peer_name   TEXT,
  message     TEXT NOT NULL,
  severity    TEXT DEFAULT 'info',
  is_read     INTEGER DEFAULT 0,
  timestamp   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_ts ON notifications(timestamp);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(is_read);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

// ============================================================
// SEED DEFAULT ADMIN
// ============================================================
const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(config.adminUsername);
if (!existingAdmin) {
  if (!config.adminPassword) {
    throw new Error('ADMIN_PASSWORD must be set before initializing the admin account.');
  }
  const hash = bcrypt.hashSync(config.adminPassword, 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(config.adminUsername, hash);
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/** Verifikasi password admin */
export function verifyAdmin(username, password) {
  const row = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!row) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  return { id: row.id, username: row.username };
}

/** Update password admin */
export function updateAdminPassword(username, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 10);
  const result = db.prepare('UPDATE admin_users SET password_hash = ?, updated_at = datetime(\'now\') WHERE username = ?').run(hash, username);
  return result.changes > 0;
}

/** Cek password admin (untuk ganti password) */
export function checkAdminPassword(username, password) {
  const row = db.prepare('SELECT password_hash FROM admin_users WHERE username = ?').get(username);
  if (!row) return false;
  return bcrypt.compareSync(password, row.password_hash);
}

/** Upsert peer VPN */
export function upsertPeer(peer) {
  db.prepare(`
    INSERT INTO vpn_peers (public_key, name, email, ip_address, endpoint, allowed_ips)
    VALUES (@public_key, @name, @email, @ip_address, @endpoint, @allowed_ips)
    ON CONFLICT(ip_address) DO UPDATE SET
      public_key  = COALESCE(excluded.public_key, vpn_peers.public_key),
      name        = COALESCE(excluded.name, vpn_peers.name),
      email       = COALESCE(excluded.email, vpn_peers.email),
      endpoint    = COALESCE(excluded.endpoint, vpn_peers.endpoint),
      allowed_ips = COALESCE(excluded.allowed_ips, vpn_peers.allowed_ips),
      updated_at  = datetime('now')
  `).run(peer);
}

/** Update status koneksi peer */
export function updatePeerStatus(ip, status) {
  db.prepare(`
    UPDATE vpn_peers SET
      is_connected = @is_connected,
      last_handshake = @last_handshake,
      rx_bytes = @rx_bytes,
      tx_bytes = @tx_bytes,
      prev_rx_bytes = @prev_rx_bytes,
      prev_tx_bytes = @prev_tx_bytes,
      handshake_ts = @handshake_ts,
      endpoint = COALESCE(@endpoint, endpoint),
      updated_at = datetime('now')
    WHERE ip_address = @ip
  `).run({ ip, ...status });
}

/** Update info peer (nama, email) */
export function updatePeerInfo(ip, name, email, newIp = ip) {
  db.prepare(`
    UPDATE vpn_peers SET name = ?, email = ?, ip_address = ?, allowed_ips = ?, updated_at = datetime('now') WHERE ip_address = ?
  `).run(name, email, newIp, `${newIp}/32`, ip);
}

/** Drop current peer rows while retaining historical connection and DNS events. */
export function removePeerRowsExcept(ips) {
  const activeIps = new Set(ips);
  const existing = db.prepare('SELECT ip_address FROM vpn_peers').all();
  const remove = db.prepare('DELETE FROM vpn_peers WHERE ip_address = ?');
  db.transaction(() => {
    for (const peer of existing) if (!activeIps.has(peer.ip_address)) remove.run(peer.ip_address);
  })();
}

/** Catat event koneksi */
export function logConnectionEvent(event) {
  db.prepare(`
    INSERT INTO connection_events (peer_ip, peer_name, event_type, duration, rx_bytes, tx_bytes, timestamp)
    VALUES (@peer_ip, @peer_name, @event_type, @duration, @rx_bytes, @tx_bytes, COALESCE(@timestamp, datetime('now')))
  `).run({ ...event, timestamp: event.timestamp ?? null });
}

/** Catat query DNS (upsert: satu entry per peer_ip + domain, update timestamp) */
export function logDnsQuery(query) {
  const recordQuery = db.transaction((row) => {
    db.prepare(`
      INSERT OR IGNORE INTO dns_query_events
        (source_key, peer_ip, peer_name, domain, query_type, is_blocked, is_ai, ai_service, timestamp)
      VALUES
        (@source_key, @peer_ip, @peer_name, @domain, @query_type, @is_blocked, @is_ai, @ai_service, COALESCE(@timestamp, datetime('now')))
    `).run(row);

    db.prepare(`
    INSERT INTO dns_queries (peer_ip, peer_name, domain, query_type, is_blocked, is_ai, ai_service, timestamp)
    VALUES (@peer_ip, @peer_name, @domain, @query_type, @is_blocked, @is_ai, @ai_service, COALESCE(@timestamp, datetime('now')))
    ON CONFLICT(peer_ip, domain) DO UPDATE SET
      peer_name   = COALESCE(excluded.peer_name, dns_queries.peer_name),
      query_type  = excluded.query_type,
      is_blocked  = MAX(dns_queries.is_blocked, excluded.is_blocked),
      is_ai       = MAX(dns_queries.is_ai, excluded.is_ai),
      ai_service  = COALESCE(excluded.ai_service, dns_queries.ai_service),
      timestamp   = COALESCE(excluded.timestamp, datetime('now'))
    `).run(row);
  });
  recordQuery({
    ...query,
    source_key: query.sourceKey ?? null,
    timestamp: query.timestamp ?? null,
  });
}

/** Catat bandwidth sample */
export function logBandwidthSample(sample) {
  db.prepare(`
    INSERT INTO bandwidth_samples (peer_ip, rx_bytes, tx_bytes, rx_rate, tx_rate)
    VALUES (@peer_ip, @rx_bytes, @tx_bytes, @rx_rate, @tx_rate)
  `).run(sample);
}

/** Buat notifikasi */
export function createNotification(notif) {
  db.prepare(`
    INSERT INTO notifications (type, peer_ip, peer_name, message, severity, timestamp)
    VALUES (@type, @peer_ip, @peer_name, @message, @severity, COALESCE(@timestamp, datetime('now')))
  `).run({ ...notif, timestamp: notif.timestamp ?? null });
}

/** Tandai notifikasi sebagai dibaca */
export function markNotificationRead(id) {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
}

/** Tandai semua notifikasi sebagai dibaca */
export function markAllNotificationsRead() {
  db.prepare('UPDATE notifications SET is_read = 1').run();
}

/** Hapus data lama */
export function cleanupOldData() {
  const hours = config.dataRetentionHours;
  db.prepare(`DELETE FROM dns_queries WHERE timestamp < datetime('now', ?)`).run(`-${hours} hours`);
  db.prepare(`DELETE FROM bandwidth_samples WHERE timestamp < datetime('now', ?)`).run(`-${hours} hours`);
  db.prepare(`DELETE FROM connection_events WHERE timestamp < datetime('now', ?)`).run(`-${hours} hours`);
  db.prepare(`DELETE FROM notifications WHERE timestamp < datetime('now', ?)`).run(`-${hours} hours`);
}

/** Reset SEMUA data - hapus peers, DNS, notifikasi, events. Admin & settings tetap aman */
export function resetAllData() {
  db.prepare('DELETE FROM dns_queries').run();
  db.prepare('DELETE FROM dns_query_events').run();
  db.prepare('DELETE FROM bandwidth_samples').run();
  db.prepare('DELETE FROM connection_events').run();
  db.prepare('DELETE FROM notifications').run();
  db.prepare('DELETE FROM vpn_peers').run();
  // Reset auto-increment counters
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('dns_queries','dns_query_events','bandwidth_samples','connection_events','notifications','vpn_peers')").run();
}

/** Get / set setting */
export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export default db;
