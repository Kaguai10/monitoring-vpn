import { existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { createHash } from 'crypto';
import config from '../config.js';

/**
 * Service untuk membaca dan parse log dnsmasq.
 *
 * dnsmasq harus dikonfigurasi dengan:
 *   log-queries
 *   log-facility=/var/log/dnsmasq.log
 *
 * Format log dnsmasq:
 *   Oct 31 12:00:00 hostname dnsmasq[1234]: query[A] example.com from 10.0.0.2
 *
 * Kita fokus pada baris "query[TYPE] domain from IP"
 */

// Mulai membaca dari akhir file yang sudah ada saat proses berjalan, supaya
// restart aplikasi tidak mengimpor ulang seluruh riwayat DNS sebagai kejadian baru.
let lastReadPosition = (() => {
  try {
    return existsSync(config.dnsmasqLogPath) ? statSync(config.dnsmasqLogPath).size : 0;
  } catch {
    return 0;
  }
})();

/**
 * Baca baris baru dari log dnsmasq sejak pembacaan terakhir.
 * Menggunakan file offset tracking agar hanya membaca data baru.
 * @returns {Array} array of { domain, clientIp, queryType, raw }
 */
export function readNewDnsQueriesSync() {
  const logPath = config.dnsmasqLogPath;
  if (!existsSync(logPath)) return [];

  let stat;
  try {
    stat = statSync(logPath);
  } catch {
    return [];
  }

  // Jika file di-truncate / berkurang ukuran, reset position
  if (stat.size < lastReadPosition) {
    lastReadPosition = 0;
  }

  // Tidak ada data baru
  if (stat.size === lastReadPosition) return [];

  const bytesToRead = stat.size - lastReadPosition;
  let content;

  try {
    const fd = openSync(logPath, 'r');
    const buffer = Buffer.alloc(bytesToRead);
    readSync(fd, buffer, 0, bytesToRead, lastReadPosition);
    closeSync(fd);
    content = buffer.toString('utf8');
    lastReadPosition = stat.size;
  } catch {
    return [];
  }

  const lines = content.split('\n');
  const queries = [];
  let linePosition = lastReadPosition - bytesToRead;

  for (const line of lines) {
    const parsed = line ? parseDnsmasqLine(line) : null;
    if (parsed) {
      parsed.sourceKey = createDnsSourceKey(linePosition, line, parsed.timestamp);
      queries.push(parsed);
    }
    linePosition += Buffer.byteLength(line) + 1;
  }

  return queries;
}

/**
 * Parse satu baris log dnsmasq.
 * Format: "... dnsmasq[PID]: query[TYPE] domain from IP"
 * @returns {Object|null} { queryType, domain, clientIp, raw }
 */
export function parseDnsmasqLine(line) {
  // Match: query[A] example.com from 10.0.0.2
  const match = line.match(/query\[([^\]]+)\]\s+(\S+)\s+from\s+(\d+\.\d+\.\d+\.\d+)/);
  if (!match) return null;

  const timestamp = parseSyslogTimestamp(line);

  return {
    queryType: match[1],
    domain: match[2],
    clientIp: match[3],
    timestamp,
    raw: line,
  };
}

// dnsmasq's syslog prefix has no year or timezone. The host that writes this
// file runs in UTC, so retain that source instant and format it as SQLite UTC.
function parseSyslogTimestamp(line) {
  const match = line.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s/);
  if (!match) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months.indexOf(match[1]);
  if (month < 0) return null;

  const now = new Date();
  const year = now.getUTCFullYear();
  const years = [year - 1, year, year + 1];
  const value = years
    .map(candidateYear => Date.UTC(candidateYear, month, Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])))
    .sort((a, b) => Math.abs(a - now.getTime()) - Math.abs(b - now.getTime()))[0];

  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

export function createDnsSourceKey(position, line, timestamp) {
  return createHash('sha256').update(`${position}\0${timestamp || ''}\0${line}`).digest('hex');
}

/**
 * Reset posisi baca (untuk testing)
 */
export function resetReadPosition() {
  lastReadPosition = 0;
}

export default { readNewDnsQueriesSync, parseDnsmasqLine, createDnsSourceKey, resetReadPosition };
