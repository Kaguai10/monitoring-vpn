import { execFileSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import config from '../config.js';
import { removePeerRowsExcept, upsertPeer } from '../db.js';
import { ensureTemplate, readUsers, templatePath, writeUsers } from './user-directory.js';

const clientsDir = process.env.CLIENT_DIR || '/etc/wireguard/clients';
const network = process.env.VPN_NETWORK || '10.66.66.0/24';
const rangeStart = process.env.VPN_CLIENT_RANGE_START || '10.66.66.101';
const rangeEnd = process.env.VPN_CLIENT_RANGE_END || '10.66.66.115';

function command(commandName, args) {
  return execFileSync(commandName, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 }).trim();
}

function validateFilename(filename) {
  if (!/^[A-Za-z0-9_.@+-]+\.conf$/.test(filename || '')) throw new Error(`Nama target_file tidak aman: ${filename || '(kosong)'}`);
}

function safeName(name) {
  const value = name.normalize('NFKD').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 55);
  return value || 'client';
}

function pool() {
  const number = value => {
    const parts = value.split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) throw new Error('Alamat IPv4 pada .env tidak valid.');
    return parts.reduce((n, part) => n * 256 + Number(part), 0);
  };
  const [cidr, prefixText] = network.split('/');
  const prefix = Number(prefixText);
  const base = number(cidr), first = number(rangeStart), last = number(rangeEnd);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32 || first > last || (base & mask) !== (first & mask) || (base & mask) !== (last & mask)) {
    throw new Error('Rentang IP VPN pada .env tidak valid.');
  }
  return Array.from({ length: last - first + 1 }, (_, i) => {
    let value = first + i;
    return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
  });
}

function getLivePeerIps() {
  const output = command('wg', ['show', config.wgInterface, 'allowed-ips']);
  const addresses = output.split(/\r?\n/).flatMap(line => line.trim().split(/\s+/).slice(1));
  return new Set(addresses.flatMap(value => value.split(',')).map(value => value.trim().split('/')[0]).filter(Boolean));
}

function backupWireGuardConfig() {
  const backupPath = `${config.wgConfigPath}.backup.users-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
  copyFileSync(config.wgConfigPath, backupPath);
  chmodSync(backupPath, 0o600);
}

export function getUserManagementMeta() {
  ensureTemplate();
  const current = readUsers();
  const used = new Set(current.map(user => user.ip));
  if (!config.demoMode) {
    try { for (const ip of getLivePeerIps()) used.add(ip); }
    catch { /* report an empty pool; the create request will return the WireGuard error */ }
  }
  return { users: current, availableIps: pool().filter(ip => !used.has(ip)), total: current.length };
}

function validateRows(users, against = [], replaceableIps = new Set()) {
  const errors = [];
  const seen = new Map();
  const poolIps = new Set(pool());
  let liveIps = new Set();
  if (!config.demoMode) { try { liveIps = getLivePeerIps(); } catch { /* addPeers will report when WireGuard is unavailable */ } }
  users.forEach((user, index) => {
    const row = index + 2;
    const name = (user.name || '').trim();
    const email = (user.email || '').trim();
    const ip = (user.ip || '').trim();
    const target = (user.target_file || `${safeName(name)}.conf`).trim();
    user.name = name; user.email = email; user.ip = ip; user.target_file = target;
    if (!name) errors.push(`Baris ${row}: name wajib diisi.`);
    if (!email) errors.push(`Baris ${row}: email wajib diisi.`);
    if (!poolIps.has(ip)) errors.push(`Baris ${row}: IP VPN ${ip || '(kosong)'} di luar rentang yang diizinkan.`);
    if (liveIps.has(ip) && !replaceableIps.has(ip)) errors.push(`Baris ${row}: IP VPN ${ip} sudah dipakai peer WireGuard lain.`);
    try { validateFilename(target); } catch (error) { errors.push(`Baris ${row}: ${error.message}`); }
    for (const [field, value] of [['name', name.toLowerCase()], ['email', email.toLowerCase()], ['target_file', target.toLowerCase()], ['ip', ip]]) {
      if (!value) continue;
      const key = `${field}:${value}`;
      if (seen.has(key)) errors.push(`Duplikat di file: ${field} "${value}" pada baris ${seen.get(key)} dan ${row}.`);
      else seen.set(key, row);
      const existing = against.find(item => String(item[field === 'ip' ? 'ip' : field] || '').toLowerCase() === value);
      if (existing) errors.push(`Duplikat dengan user lama: ${field} "${value}" (${existing.name}, ${existing.ip}).`);
    }
  });
  if (errors.length) throw Object.assign(new Error('CSV berisi data tidak valid atau duplikat.'), { details: errors });
  return users;
}

export function previewUserImport(users, strategy) {
  const existing = readUsers();
  validateRows(users, strategy === 'append' ? existing : [], strategy === 'replace' ? new Set(existing.map(user => user.ip)) : new Set());
  if (strategy !== 'append' && strategy !== 'replace') throw new Error('Pilih tambah atau ganti daftar.');
  return users.length;
}

function interfaceAndPublicKey() {
  if (config.demoMode) throw new Error('Pengelolaan user WireGuard hanya tersedia pada mode riil.');
  return command('wg', ['show', config.wgInterface, 'public-key']);
}

function getPublicKeyFromConfig(filename) {
  const path = `${clientsDir}/${filename}`;
  if (!existsSync(path)) return null;
  const privateKey = readFileSync(path, 'utf8').match(/^PrivateKey\s*=\s*(.+)$/m)?.[1]?.trim();
  if (!privateKey) return null;
  return execFileSync('wg', ['pubkey'], { input: `${privateKey}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function addPeers(users) {
  mkdirSync(clientsDir, { recursive: true, mode: 0o700 });
  const serverPublicKey = interfaceAndPublicKey();
  if (users.length) backupWireGuardConfig();
  const created = [];
  try {
    for (const user of users) {
      const clientPrivate = command('wg', ['genkey']);
      const clientPublic = execFileSync('wg', ['pubkey'], { input: `${clientPrivate}\n`, encoding: 'utf8' }).trim();
      const clientPath = `${clientsDir}/${user.target_file}`;
      if (existsSync(clientPath)) throw new Error(`File ${user.target_file} sudah ada.`);
      const clientConfig = `[Interface]\nPrivateKey = ${clientPrivate}\nAddress = ${user.ip}/32\nDNS = ${process.env.VPN_SERVER_IP || '10.66.66.1'}\n\n[Peer]\nPublicKey = ${serverPublicKey}\nEndpoint = ${process.env.WG_PUBLIC_IP}:${process.env.WG_PORT || 51820}\nAllowedIPs = ${process.env.CLIENT_ALLOWED_IPS || '0.0.0.0/0, ::/0'}\nPersistentKeepalive = 25\n`;
      writeFileSync(clientPath, clientConfig, { mode: 0o600, flag: 'wx' });
      const peerBlock = `\n# VPN client: ${user.target_file}\n[Peer]\nPublicKey = ${clientPublic}\nAllowedIPs = ${user.ip}/32\n`;
      writeFileSync(config.wgConfigPath, `${readFileSync(config.wgConfigPath, 'utf8').trimEnd()}\n${peerBlock}`, { mode: 0o600 });
      created.push({ user, clientPath, clientPublic, peerBlock });
      command('wg', ['set', config.wgInterface, 'peer', clientPublic, 'allowed-ips', `${user.ip}/32`]);
    }
    return created;
  } catch (error) {
    for (const peer of created.reverse()) {
      try { command('wg', ['set', config.wgInterface, 'peer', peer.clientPublic, 'remove']); } catch { /* continue rollback */ }
      try { unlinkSync(peer.clientPath); } catch { /* continue rollback */ }
      const current = readFileSync(config.wgConfigPath, 'utf8').replace(peer.peerBlock, '');
      writeFileSync(config.wgConfigPath, current, { mode: 0o600 });
    }
    throw error;
  }
}

function removePeers(users) {
  if (users.length) backupWireGuardConfig();
  const configText = readFileSync(config.wgConfigPath, 'utf8');
  const blocks = configText.split(/(?=^\[Peer\]\s*$)/mi);
  const removeIps = new Set(users.map(user => user.ip));
  const kept = [blocks[0]];
  const removedKeys = [];
  for (const block of blocks.slice(1)) {
    const allowed = block.match(/^AllowedIPs\s*=\s*(.+)$/mi)?.[1] || '';
    const addresses = allowed.split(',').map(value => value.trim().replace(/\/32$/, ''));
    const clientIp = addresses.find(ip => removeIps.has(ip));
    if (clientIp) {
      const key = block.match(/^PublicKey\s*=\s*(.+)$/mi)?.[1]?.trim();
      if (key) removedKeys.push(key);
    } else kept.push(block);
  }
  for (const user of users) {
    const publicKey = getPublicKeyFromConfig(user.target_file);
    if (publicKey && !removedKeys.includes(publicKey)) removedKeys.push(publicKey);
  }
  for (const publicKey of removedKeys) command('wg', ['set', config.wgInterface, 'peer', publicKey, 'remove']);
  writeFileSync(config.wgConfigPath, kept.join('').trimEnd() + '\n', { mode: 0o600 });
  for (const user of users) {
    try { unlinkSync(`${clientsDir}/${user.target_file}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function syncPeerRows(created) {
  for (const peer of created) {
    upsertPeer({
      public_key: peer.clientPublic, name: peer.user.name, email: peer.user.email,
      ip_address: peer.user.ip, endpoint: null, allowed_ips: `${peer.user.ip}/32`,
    });
  }
}

export function addUsers(users) {
  const existing = readUsers();
  validateRows(users, existing);
  const created = addPeers(users);
  writeUsers([...existing, ...users]);
  syncPeerRows(created);
  return users.length;
}

export function replaceUsers(users) {
  const existing = readUsers();
  validateRows(users, [], new Set(existing.map(user => user.ip)));
  removePeers(existing);
  let created;
  try { created = addPeers(users); }
  catch (error) {
    // Best effort: old roster is restored if recreating the requested list fails.
    addPeers(existing);
    throw error;
  }
  writeUsers(users);
  removePeerRowsExcept(users.map(user => user.ip));
  syncPeerRows(created);
  return users.length;
}

export function deleteAllUsers() {
  const existing = readUsers();
  ensureTemplate();
  removePeers(existing);
  writeUsers([]);
  removePeerRowsExcept([]);
  return existing.length;
}

export function deleteUser(ip) {
  if (config.demoMode) throw new Error('Pengelolaan user WireGuard hanya tersedia pada mode riil.');
  const users = readUsers();
  const user = users.find(item => item.ip === ip);
  if (!user) throw new Error('User tidak ditemukan.');
  removePeers([user]);
  const remaining = users.filter(item => item.ip !== ip);
  writeUsers(remaining);
  removePeerRowsExcept(remaining.map(item => item.ip));
  return user;
}

export function restoreTemplateUsers() {
  ensureTemplate();
  const users = readUsers(templatePath);
  return replaceUsers(users);
}

export function editUser(currentIp, changes) {
  if (config.demoMode) throw new Error('Edit user WireGuard hanya tersedia pada mode riil.');
  const users = readUsers();
  const index = users.findIndex(user => user.ip === currentIp);
  if (index < 0) throw new Error('User tidak ditemukan.');
  const current = users[index];
  const name = String(changes.name || '').trim();
  const email = String(changes.email || '').trim();
  const newIp = String(changes.ip || '').trim();
  if (!name || name.length > 80) throw new Error('Nama wajib diisi dan maksimal 80 karakter.');
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email tidak valid.');
  if (!pool().includes(newIp)) throw new Error('IP harus berada dalam rentang IP client yang diizinkan.');
  if (users.some((user, i) => i !== index && user.ip === newIp)) throw new Error(`IP ${newIp} sudah dipakai user lain.`);

  if (newIp === currentIp) {
    const updatedUsers = users.map((user, i) => i === index ? { ...user, name, email } : user);
    writeUsers(updatedUsers);
    updatePeerInfo(currentIp, name, email, currentIp);
    return { ip: currentIp, message: 'Data user berhasil diperbarui.' };
  }

  const clientPath = `${clientsDir}/${current.target_file}`;
  if (!existsSync(clientPath)) throw new Error(`File config ${current.target_file} tidak ditemukan.`);
  const clientOriginal = readFileSync(clientPath, 'utf8');
  const privateKey = clientOriginal.match(/^PrivateKey\s*=\s*(.+)$/m)?.[1]?.trim();
  if (!privateKey) throw new Error('Private key pada file config tidak ditemukan.');
  const publicKey = execFileSync('wg', ['pubkey'], { input: `${privateKey}\n`, encoding: 'utf8' }).trim();
  const configOriginal = readFileSync(config.wgConfigPath, 'utf8');
  const peerBlocks = configOriginal.split(/(?=^\[Peer\]\s*$)/mi);
  let foundPeer = false;
  const configUpdated = peerBlocks.map(block => {
    if (block.match(/^PublicKey\s*=\s*(.+)$/mi)?.[1]?.trim() !== publicKey) return block;
    const allowedMatch = block.match(/^(AllowedIPs\s*=\s*)([^\r\n]+)$/mi);
    if (!allowedMatch || !allowedMatch[2].split(',').map(value => value.trim()).includes(`${currentIp}/32`)) return block;
    foundPeer = true;
    return block.replace(/^(AllowedIPs\s*=\s*)[^\r\n]+$/mi, `$1${newIp}/32`);
  }).join('');
  if (!foundPeer) throw new Error('Peer user tidak ditemukan di konfigurasi WireGuard.');

  if (newIp !== currentIp) {
    const liveIps = getLivePeerIps();
    if (liveIps.has(newIp)) throw new Error(`IP ${newIp} sudah digunakan peer WireGuard lain.`);
  }
  const addressPattern = /^Address\s*=\s*([^\r\n]+)$/mi;
  if (!addressPattern.test(clientOriginal)) throw new Error('Alamat client tidak ditemukan di file config.');
  const clientUpdated = clientOriginal.replace(addressPattern, `Address = ${newIp}/32`);

  const updatedUsers = users.map((user, i) => i === index ? { ...user, name, email, ip: newIp } : user);
  backupWireGuardConfig();
  const configTemp = `${config.wgConfigPath}.edit.tmp`;
  const clientTemp = `${clientPath}.edit.tmp`;
  let configWritten = false;
  let clientWritten = false;
  let liveUpdated = false;
  let databaseUpdated = false;
  try {
    writeFileSync(configTemp, configUpdated, { mode: 0o600 });
    renameSync(configTemp, config.wgConfigPath);
    configWritten = true;
    writeFileSync(clientTemp, clientUpdated, { mode: 0o600 });
    chmodSync(clientTemp, 0o600);
    renameSync(clientTemp, clientPath);
    clientWritten = true;
    command('wg', ['set', config.wgInterface, 'peer', publicKey, 'allowed-ips', `${newIp}/32`]);
    liveUpdated = true;
    updatePeerInfo(currentIp, name, email, newIp);
    databaseUpdated = true;
    writeUsers(updatedUsers);
  } catch (error) {
    if (databaseUpdated) { try { updatePeerInfo(newIp, current.name, current.email, currentIp); } catch { /* best effort rollback */ } }
    if (liveUpdated) { try { command('wg', ['set', config.wgInterface, 'peer', publicKey, 'allowed-ips', `${currentIp}/32`]); } catch { /* best effort rollback */ } }
    if (clientWritten) writeFileSync(clientPath, clientOriginal, { mode: 0o600 });
    if (configWritten) writeFileSync(config.wgConfigPath, configOriginal, { mode: 0o600 });
    throw error;
  }
  return { ip: newIp, message: 'Data user berhasil diperbarui.' };
}

export function exportClientConfigs(ips) {
  const users = readUsers();
  const selected = ips.map(ip => {
    const user = users.find(item => item.ip === ip);
    if (!user) throw new Error(`User dengan IP ${ip} tidak ditemukan.`);
    const path = `${clientsDir}/${user.target_file}`;
    if (!existsSync(path)) throw new Error(`File konfigurasi ${user.target_file} tidak ditemukan.`);
    return { name: user.target_file, data: readFileSync(path) };
  });
  return selected;
}

export function getTemplateCsv() {
  ensureTemplate();
  return readFileSync(templatePath, 'utf8');
}
