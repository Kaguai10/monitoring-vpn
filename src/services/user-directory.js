import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const csvPath = resolve(process.env.USER_DIRECTORY_CSV || join(appRoot, 'data', 'participants.csv'));
export const templatePath = resolve(process.env.USER_DIRECTORY_TEMPLATE_CSV || join(appRoot, 'data', 'participants.template.csv'));
export const CSV_HEADERS = ['name', 'email', 'password', 'affiliation', 'target_file', 'IP VPN'];

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value.trim())) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (field.length || row.length) { row.push(field); if (row.some(value => value.trim())) rows.push(row); }
  return rows;
}

export function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function stringifyUsers(users) {
  return [CSV_HEADERS.join(','), ...users.map(user => [user.name, user.email, '', '', user.target_file, user.ip].map(csvEscape).join(','))].join('\r\n') + '\r\n';
}

export function readUsers(path = csvPath) {
  if (!existsSync(path)) return [];
  const rows = parseCsv(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  if (!rows.length) return [];
  const headers = rows[0].map(value => value.trim().toLowerCase());
  const index = { name: headers.indexOf('name'), email: headers.indexOf('email'), target_file: headers.indexOf('target_file'), ip: headers.indexOf('ip vpn') };
  if (index.name < 0 || index.ip < 0) throw new Error('Header CSV wajib mencakup name dan IP VPN.');
  return rows.slice(1).map(values => ({
    name: (values[index.name] || '').trim(),
    email: index.email >= 0 ? (values[index.email] || '').trim() : '',
    target_file: index.target_file >= 0 ? (values[index.target_file] || '').trim() : '',
    ip: (values[index.ip] || '').trim(),
  })).filter(user => user.name && user.ip);
}

export function writeUsers(users, path = csvPath) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, stringifyUsers(users), { mode: 0o600 });
  renameSync(tempPath, path);
}

export function ensureTemplate() {
  if (!existsSync(templatePath) && existsSync(csvPath)) {
    copyFileSync(csvPath, templatePath);
    // Keep the roster snapshot private; it contains identifying information.
    chmodSync(templatePath, 0o600);
  }
}

export function getUserByIp(ip) { return readUsers().find(user => user.ip === ip) || null; }
export function getUserName(ip, fallback = null) { return getUserByIp(ip)?.name || fallback; }
