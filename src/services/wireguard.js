import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import config from '../config.js';

let interfaceCommandWarned = false;
let allInterfacesCommandWarned = false;
let configFileWarned = false;

/**
 * Service untuk membaca status WireGuard.
 * Menggunakan `wg show all dump` yang menghasilkan format tab-separated.
 *
 * Format output "wg show all dump":
 * Baris interface:  interface  private-key  listen-port  fwmark
 * Baris peer:        interface  public-key  preshared-key  endpoint  allowed-ips  latest-handshake  rx-bytes  tx-bytes  keepalive
 *
 * latest-handshake adalah Unix timestamp (0 = belum pernah handshake)
 * rx-bytes / tx-bytes adalah total bytes sejak peer terhubung
 */

/**
 * Parse output `wg show all dump`
 * @returns {Array} array peer objects
 */
export function getWireGuardPeers() {
  let output;
  let source = '';
  try {
    output = execSync(`wg show ${config.wgInterface} dump 2>/dev/null`, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    source = `wg show ${config.wgInterface} dump`;
    interfaceCommandWarned = false;
  } catch (e) {
    if (!interfaceCommandWarned) {
      console.warn(`[WireGuard] "wg show ${config.wgInterface} dump" gagal: ${e.message}`);
      interfaceCommandWarned = true;
    }
    try {
      output = execSync('wg show all dump 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      source = 'wg show all dump';
      allInterfacesCommandWarned = false;
    } catch (e2) {
      if (!allInterfacesCommandWarned) {
        console.warn(`[WireGuard] "wg show all dump" juga gagal: ${e2.message}`);
        allInterfacesCommandWarned = true;
      }
      return [];
    }
  }

  const lines = output.trim().split('\n').filter(Boolean);
  const peers = [];
  let interfaceName = config.wgInterface;

  for (const line of lines) {
    let parts = line.split('\t');

    // Normalisasi: jika 8 field (tanpa kolom interface), prepend interface name
    if (parts.length === 8) {
      parts = [interfaceName, ...parts];
    }

    // Baris peer punya 9 kolom; baris interface punya 4-5 kolom (di-skip)
    if (parts.length !== 9) continue;

    const publicKey = parts[1];
    if (!publicKey || publicKey === '(none)') continue;

    interfaceName = parts[0];
    const endpoint = parts[3];
    const allowedIps = parts[4];
    const latestHandshake = parseInt(parts[5], 10); // Unix timestamp
    const rxBytes = parseInt(parts[6], 10);
    const txBytes = parseInt(parts[7], 10);
    const persistentKeepalive = parseInt(parts[8], 10);

    // Extract IP dari allowed-ips (format: 10.0.0.2/32)
    const ipMatch = allowedIps.match(/(\d+\.\d+\.\d+\.\d+)/);
    const ipAddress = ipMatch ? ipMatch[1] : allowedIps;

    peers.push({
      interface: interfaceName,
      publicKey,
      endpoint: endpoint && endpoint !== '(none)' ? endpoint : null,
      allowedIps,
      ipAddress,
      handshakeTs: latestHandshake,
      rxBytes,
      txBytes,
      persistentKeepalive,
    });
  }

  // Coba ambil nama/email dari config file
  const peerInfo = parseWgConfig();

  return peers.map(peer => {
    const info = peerInfo[peer.publicKey] || {};
    return {
      ...peer,
      name: info.name || null,
      email: info.email || null,
    };
  });
}

/**
 * Fallback: baca peer dari file konfigurasi WireGuard.
 * Digunakan ketika `wg show` tidak mengembalikan data (misal interface
 * tidak terlihat dari container). Hanya memberikan info dasar (IP, nama,
 * email) tanpa status live (handshake, rx/tx, online/offline).
 */
export function getPeersFromConfig() {
  if (!existsSync(config.wgConfigPath)) {
    if (!configFileWarned) {
      console.warn(`[WireGuard] File config tidak ditemukan: ${config.wgConfigPath}`);
      configFileWarned = true;
    }
    return [];
  }
  configFileWarned = false;

  let content;
  try {
    content = readFileSync(config.wgConfigPath, 'utf8');
  } catch (e) {
    console.warn(`[WireGuard] Gagal membaca config: ${e.message}`);
    return [];
  }

  const blocks = content.split(/\[Peer\]/i);
  const peers = [];

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const precedingText = blocks[i - 1];

    // Public Key
    const pubKeyMatch = block.match(/PublicKey\s*=\s*(\S+)/i);
    if (!pubKeyMatch) continue;
    const publicKey = pubKeyMatch[1].trim();

    // Allowed IPs
    const allowedIpsMatch = block.match(/AllowedIPs\s*=\s*(\S+)/i);
    if (!allowedIpsMatch) continue;
    const allowedIps = allowedIpsMatch[1].trim();

    const ipMatch = allowedIps.match(/(\d+\.\d+\.\d+\.\d+)/);
    const ipAddress = ipMatch ? ipMatch[1] : allowedIps;

    // Nama/email dari comment terakhir sebelum [Peer]
    let name = null;
    let email = null;
    const commentLines = precedingText.trim().split('\n').filter(l => l.trim().startsWith('#'));
    if (commentLines.length > 0) {
      const comment = commentLines[commentLines.length - 1].replace(/^#\s*/, '').trim();
      name = comment;
      const emailParens = comment.match(/^(.+?)\s*\(([^)]+@[^)]+)\)\s*$/);
      if (emailParens) {
        name = emailParens[1].trim();
        email = emailParens[2].trim();
      } else {
        const emailDash = comment.match(/^(.+?)\s+-\s+(\S+@\S+)\s*$/);
        if (emailDash) {
          name = emailDash[1].trim();
          email = emailDash[2].trim();
        }
      }
    }

    peers.push({
      interface: config.wgInterface,
      publicKey,
      endpoint: null,
      allowedIps,
      ipAddress,
      handshakeTs: 0,
      rxBytes: 0,
      txBytes: 0,
      persistentKeepalive: 0,
      name,
      email,
    });
  }

  return peers;
}

/**
 * Parse file konfigurasi WireGuard untuk mendapatkan nama dan email peer.
 * Format comment yang didukung:
 *   # Nama User (email@example.com)
 *   [Peer]
 *   PublicKey = ...
 *
 *   # Nama User
 *   [Peer]
 *   PublicKey = ...
 */
function parseWgConfig() {
  const result = {};
  if (!existsSync(config.wgConfigPath)) return result;

  let content;
  try {
    content = readFileSync(config.wgConfigPath, 'utf8');
  } catch {
    return result;
  }

  // Split berdasarkan [Peer] section
  const blocks = content.split(/\[Peer\]/i);
  for (let i = 1; i < blocks.length; i++) {
    const precedingText = blocks[i - 1];

    // Cari comment terakhir sebelum [Peer]
    const commentLines = precedingText.trim().split('\n').filter(l => l.trim().startsWith('#'));
    if (commentLines.length === 0) continue;

    const comment = commentLines[commentLines.length - 1].replace(/^#\s*/, '').trim();

    // Parse nama dan email: "Nama User (email@example.com)" atau "Nama User - email@example.com"
    let name = comment;
    let email = null;

    const emailParens = comment.match(/^(.+?)\s*\(([^)]+@[^)]+)\)\s*$/);
    if (emailParens) {
      name = emailParens[1].trim();
      email = emailParens[2].trim();
    } else {
      const emailDash = comment.match(/^(.+?)\s+-\s+(\S+@\S+)\s*$/);
      if (emailDash) {
        name = emailDash[1].trim();
        email = emailDash[2].trim();
      }
    }

    // Cari PublicKey di block ini
    const pubKeyMatch = blocks[i].match(/PublicKey\s*=\s*(\S+)/i);
    if (pubKeyMatch) {
      result[pubKeyMatch[1].trim()] = { name, email };
    }
  }

  return result;
}

/**
 * Cek apakah WireGuard tersedia di sistem
 */
export function isWireGuardAvailable() {
  try {
    execSync('wg show', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export default { getWireGuardPeers, getPeersFromConfig, isWireGuardAvailable };
