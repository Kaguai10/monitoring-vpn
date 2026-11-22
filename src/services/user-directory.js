import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const csvPath = resolve(process.env.USER_DIRECTORY_CSV || join(appRoot, 'data', 'participants.csv'));

// CSV parsing with quoted fields and escaped double quotes. Only the name,
// email, and VPN IP columns are retained; password data is discarded.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some(value => value.trim())) rows.push(row);
  }
  return rows;
}

function loadDirectory() {
  const directory = new Map();
  if (!existsSync(csvPath)) {
    console.warn(`[User directory] CSV tidak ditemukan: ${csvPath}`);
    return directory;
  }

  try {
    const rows = parseCsv(readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!rows.length) return directory;
    const headers = rows[0].map(value => value.trim().toLowerCase());
    const nameIndex = headers.indexOf('name');
    const emailIndex = headers.indexOf('email');
    const ipIndex = headers.indexOf('ip vpn');
    if (nameIndex < 0 || ipIndex < 0) {
      console.warn('[User directory] Header CSV wajib mencakup name dan IP VPN.');
      return directory;
    }

    for (const values of rows.slice(1)) {
      const ip = (values[ipIndex] || '').trim();
      const name = (values[nameIndex] || '').trim();
      if (!ip || !name) continue;
      directory.set(ip, {
        name,
        email: emailIndex >= 0 ? (values[emailIndex] || '').trim() || null : null,
      });
    }
    console.log(`[User directory] ${directory.size} user dimuat dari CSV.`);
  } catch (error) {
    console.error(`[User directory] Gagal membaca CSV: ${error.message}`);
  }
  return directory;
}

const usersByIp = loadDirectory();

export function getUserByIp(ip) {
  return usersByIp.get(ip) || null;
}

export function getUserName(ip, fallback = null) {
  return getUserByIp(ip)?.name || fallback;
}
