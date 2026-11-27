/** Users roster and the dedicated registration, export, and management pages. */
let allUsers = [];
let currentFilter = 'all';
let searchQuery = '';
let selectedIps = new Set();
let selectedCsvText = '';
let previewedUsers = [];
const sortStates = { export: { key: 'name', ascending: true }, manage: { key: 'name', ascending: true } };

function notifyUser(message, type = 'success') {
  showToast({ message, type: type === 'error' ? 'blocked_dns' : 'ai_access' });
}

function confirmUserAction(title, message, buttonLabel = 'Lanjutkan', details = []) {
  return confirmAction({ title, message, confirmLabel: buttonLabel, details });
}

async function postJson(url, payload) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Permintaan gagal.');
    error.details = data.details || [];
    throw error;
  }
  return data;
}

async function loadUsers() {
  try {
    const data = await api('/api/users');
    allUsers = data.users || [];
    const summary = document.getElementById('usersSummary');
    if (summary) {
      summary.style.display = 'flex';
      document.getElementById('totalCount').textContent = data.total;
      document.getElementById('onlineCount').textContent = data.connected;
      document.getElementById('offlineCount').textContent = data.total - data.connected;
    }
    const ipSelect = document.getElementById('newUserIp');
    if (ipSelect) {
      const meta = await api('/api/users/manage/meta');
      const currentValue = ipSelect.value;
      ipSelect.innerHTML = meta.availableIps.length
        ? '<option value="">Pilih IP VPN</option>' + meta.availableIps.map(ip => `<option value="${escapeHtml(ip)}">${escapeHtml(ip)}</option>`).join('')
        : '<option value="">Tidak ada IP kosong</option>';
      document.getElementById('availableIpsHint').textContent = meta.availableIps.length
        ? `${meta.availableIps.length} alamat IP siap digunakan.`
        : 'Semua IP pada rentang VPN sedang dipakai. Perluas rentang client di .env sebelum menambah user.';
      if (meta.availableIps.includes(currentValue)) ipSelect.value = currentValue;
    }
    if (document.getElementById('userCardsGrid')) renderUsers();
    if (document.getElementById('exportUserList')) renderExportUsers();
    updateSelectedCount();
    updateLastUpdate();
  } catch (err) {
    console.error('Users error:', err);
    const grid = document.getElementById('userCardsGrid') || document.getElementById('exportUserList');
    if (grid) grid.innerHTML = '<div class="empty-state"><p>Gagal memuat data user</p></div>';
  }
}

function filteredUsers() {
  let users = allUsers;
  if (currentFilter === 'connected') users = users.filter(user => user.is_connected);
  else if (currentFilter === 'disconnected') users = users.filter(user => !user.is_connected);
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    users = users.filter(user => [user.name, user.email, user.ip_address].some(value => (value || '').toLowerCase().includes(query)));
  }
  return users;
}

function renderUsers() {
  const grid = document.getElementById('userCardsGrid');
  const noUsers = document.getElementById('noUsers');
  const users = filteredUsers();
  if (!users.length) { grid.innerHTML = ''; noUsers.style.display = 'flex'; return; }
  noUsers.style.display = 'none';
  grid.innerHTML = users.map(user => {
    const online = user.is_connected === 1;
    const strength = user.strength || 0;
    return `<a href="/users/${encodeURIComponent(user.ip_address)}" class="user-card ${online ? 'online' : 'offline'}">
      <div class="user-card-top"><div class="user-avatar" style="background:${avatarColor(user.name || user.ip_address)}">${initials(user.name || user.ip_address)}</div>
      <div class="user-card-info"><div class="user-card-name">${escapeHtml(user.name || 'Tanpa Nama')}</div><div class="user-card-email">${escapeHtml(user.email || '-')}</div></div>
      <div class="user-card-status ${online ? 'status-online' : 'status-offline'}"><span class="status-dot"></span>${online ? 'ONLINE' : 'OFFLINE'}</div></div>
      <div class="user-card-meta"><div class="user-meta-row"><span class="user-meta-label">IP Address</span><span class="user-meta-value">${escapeHtml(user.ip_address)}</span></div>
      <div class="user-meta-row"><span class="user-meta-label">Download</span><span class="user-meta-value">${formatBytes(user.rx_bytes)}</span></div>
      <div class="user-meta-row"><span class="user-meta-label">Upload</span><span class="user-meta-value">${formatBytes(user.tx_bytes)}</span></div>
      <div class="user-meta-row"><span class="user-meta-label">Handshake</span><span class="user-meta-value">${escapeHtml(user.lastHandshakeAgo || '-')}</span></div></div>
      <div class="strength-bar"><div class="strength-fill" style="width:${strength}%;background:${strengthColor(strength)}"></div></div></a>`;
  }).join('');
}

function renderExportUsers() {
  const list = document.getElementById('exportUserList');
  const noUsers = document.getElementById('noUsers');
  if (!allUsers.length) { list.innerHTML = '<tr><td colspan="4">Belum ada user</td></tr>'; noUsers.style.display = 'flex'; return; }
  noUsers.style.display = 'none';
  list.innerHTML = sortedUsers(allUsers, 'export').map(user => `<tr><td><input class="conf-select" type="checkbox" data-ip="${escapeHtml(user.ip_address)}" aria-label="Pilih ${escapeHtml(user.name || user.ip_address)}" ${selectedIps.has(user.ip_address) ? 'checked' : ''}></td><td>${escapeHtml(user.name || 'Tanpa Nama')}</td><td>${escapeHtml(user.email || '-')}</td><td><code>${escapeHtml(user.ip_address)}</code></td></tr>`).join('');
  list.querySelectorAll('.conf-select').forEach(checkbox => checkbox.addEventListener('change', () => {
    if (checkbox.checked) selectedIps.add(checkbox.dataset.ip);
    else selectedIps.delete(checkbox.dataset.ip);
    updateSelectedCount();
  }));
  updateSortIndicators();
}

function sortedUsers(users, table) {
  const { key, ascending } = sortStates[table];
  const field = key === 'ip' ? 'ip_address' : key;
  return [...users].sort((a, b) => String(a[field] || '').localeCompare(String(b[field] || ''), 'id', { numeric: key === 'ip', sensitivity: 'base' }) * (ascending ? 1 : -1));
}

function renderManageUsers(users, availableIps) {
  const list = document.getElementById('manageUserList');
  const empty = document.getElementById('manageUsersEmpty');
  empty.style.display = users.length ? 'none' : 'flex';
  list.innerHTML = sortedUsers(users, 'manage').map(user => `<tr data-ip="${escapeHtml(user.ip)}" data-name="${escapeHtml(user.name)}" data-email="${escapeHtml(user.email)}">
    <td><input class="manage-user-input" name="name" aria-label="Nama" value="${escapeHtml(user.name)}" maxlength="80" required></td>
    <td><input class="manage-user-input" name="email" type="email" aria-label="Email" value="${escapeHtml(user.email)}" maxlength="160" required></td>
    <td><input class="manage-user-input" name="ip" aria-label="IP VPN" value="${escapeHtml(user.ip)}" list="availableUserIps" required></td>
    <td><div class="manage-row-actions"><button class="btn-secondary save-user-change" type="button">Simpan</button><button class="btn-danger delete-user" type="button">Hapus</button></div></td>
  </tr>`).join('');
  document.getElementById('availableUserIps').innerHTML = availableIps.map(ip => `<option value="${escapeHtml(ip)}"></option>`).join('');
  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll('.user-sort').forEach(button => {
    const state = sortStates[button.dataset.table];
    button.querySelector('span').textContent = state.key === button.dataset.sort ? (state.ascending ? '↑' : '↓') : '';
  });
}

document.querySelectorAll('.user-sort').forEach(button => button.addEventListener('click', () => {
  const state = sortStates[button.dataset.table];
  if (state.key === button.dataset.sort) state.ascending = !state.ascending;
  else { state.key = button.dataset.sort; state.ascending = true; }
  if (button.dataset.table === 'export') renderExportUsers();
  else loadManageUsers();
}));

function updateSelectedCount() {
  const count = document.getElementById('selectedConfigCount');
  const button = document.getElementById('downloadSelectedConfigs');
  if (count) count.textContent = `${selectedIps.size} user dipilih`;
  if (button) button.disabled = selectedIps.size === 0;
}

function showCsvPreview(ok, message, details = []) {
  const box = document.getElementById('csvPreview');
  box.hidden = false;
  box.className = `csv-preview ${ok ? 'csv-preview-ok' : 'csv-preview-error'}`;
  box.innerHTML = `<strong>${escapeHtml(message)}</strong>${details.length ? `<ul>${details.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}${ok ? '<button class="btn-primary" id="applyCsvImport" type="button">Terapkan import</button>' : ''}`;
  document.getElementById('applyCsvImport')?.addEventListener('click', applyCsvImport);
}

async function previewCsvImport() {
  const strategy = document.getElementById('csvImportStrategy').value;
  try {
    const data = await postJson('/api/users/import/preview', { csvText: selectedCsvText, strategy });
    previewedUsers = data.users || [];
    showCsvPreview(true, data.message);
  } catch (error) { showCsvPreview(false, error.message, error.details); }
}

async function applyCsvImport() {
  const strategy = document.getElementById('csvImportStrategy').value;
  const affected = previewedUsers.map(user => `${user.name} — ${user.email} — ${user.ip}`);
  let message = `${previewedUsers.length} user baru dan peer WireGuard beserta file config client akan dibuat.`;
  if (strategy === 'replace') {
    const current = await api('/api/users/manage/meta');
    const removed = (current?.users || []).map(user => `Akan diganti: ${user.name} — ${user.email} — ${user.ip}`);
    message = 'Daftar user yang ada akan diganti. Peer dan file config user saat ini akan dihapus, lalu daftar dari CSV dibuat ulang.';
    affected.unshift(...removed);
  }
  if (!await confirmUserAction(strategy === 'replace' ? 'Ganti seluruh daftar user?' : 'Import user dari CSV?', message, 'Terapkan import', affected)) return;
  const button = document.getElementById('applyCsvImport');
  button.disabled = true;
  try {
    const data = await postJson('/api/users/import', { csvText: selectedCsvText, strategy });
    document.getElementById('csvPreview').hidden = true;
    document.getElementById('userCsvFile').value = '';
    document.querySelector('.file-picker span').textContent = 'Pilih file CSV';
    document.getElementById('csvImportControls').hidden = true;
    selectedCsvText = '';
    notifyUser(data.message);
    await loadUsers();
  } catch (error) { button.disabled = false; showCsvPreview(false, error.message, error.details); }
}

async function downloadConfigs(ips) {
  if (!ips.length) return;
  const selected = allUsers.filter(user => ips.includes(user.ip_address));
  const names = selected.map(user => `${user.name || 'Tanpa Nama'} — ${user.email || '-'} — ${user.ip_address}`);
  if (!await confirmUserAction('Unduh konfigurasi VPN?', `${ips.length} file konfigurasi akan diunduh. File berisi private key dan hanya boleh dibagikan kepada pemiliknya.`, 'Unduh config', names)) return;
  const response = await fetch(`/api/users/export-configs?ips=${encodeURIComponent(ips.join(','))}`);
  if (!response.ok) {
    let data = {};
    try { data = await response.json(); } catch { /* use fallback message */ }
    notifyUser(data.error || 'Gagal mengunduh konfigurasi.', 'error');
    return;
  }
  const blob = await response.blob();
  const filename = (response.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/i)?.[1] || (ips.length === 1 ? 'user.conf' : 'vpn-users-configs.zip');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = filename; link.click();
  URL.revokeObjectURL(link.href);
}

async function loadManageUsers() {
  const list = document.getElementById('manageUserList');
  if (!list) return;
  try {
    const data = await api('/api/users/manage/meta');
    renderManageUsers(data.users || [], data.availableIps || []);
  } catch (error) {
    list.innerHTML = `<div class="csv-preview csv-preview-error">${escapeHtml(error.message || 'Gagal memuat daftar user.')}</div>`;
  }
}

document.getElementById('manageUserList')?.addEventListener('click', async event => {
  const deleteButton = event.target.closest('.delete-user');
  if (deleteButton) {
    const row = deleteButton.closest('tr');
    const userName = row.dataset.name;
    const userEmail = row.dataset.email;
    const currentIp = row.dataset.ip;
    if (!await confirmUserAction('Hapus user ini?', 'Peer WireGuard dan file config client user ini akan dihapus. Akses VPN langsung terputus.', 'Hapus user', [`${userName} — ${userEmail} — ${currentIp}`])) return;
    deleteButton.disabled = true; deleteButton.textContent = 'Menghapus...';
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(currentIp)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gagal menghapus user.');
      notifyUser(data.message);
      await loadManageUsers();
    } catch (error) {
      notifyUser(error.message, 'error');
      deleteButton.disabled = false; deleteButton.textContent = 'Hapus';
    }
    return;
  }
  const button = event.target.closest('.save-user-change');
  if (!button) return;
  const row = button.closest('tr');
  const currentIp = row.dataset.ip;
  const payload = Object.fromEntries([...row.querySelectorAll('.manage-user-input')].map(input => [input.name, input.value.trim()]));
  const changes = [];
  for (const [field, label] of [['name', 'Nama'], ['email', 'Email'], ['ip', 'IP VPN']]) {
    const before = field === 'ip' ? currentIp : row.dataset[field];
    if (payload[field] !== before) changes.push(`${label}: ${before} → ${payload[field]}`);
  }
  if (!changes.length) { notifyUser('Tidak ada perubahan untuk disimpan.'); return; }
  const message = payload.ip !== currentIp
    ? 'Perubahan akan memperbarui daftar user dan config client. Jika IP berubah, koneksi user dapat terputus dan config baru perlu diunduh.'
    : 'Perubahan ini akan memperbarui data user di daftar VPN.';
  if (!await confirmUserAction('Simpan perubahan user?', message, 'Simpan', changes)) return;
  button.disabled = true; button.textContent = 'Menyimpan...';
  try {
    const response = await fetch(`/api/users/${encodeURIComponent(currentIp)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Gagal menyimpan perubahan.');
    notifyUser(data.message);
    await loadManageUsers();
  } catch (error) {
    notifyUser(error.message, 'error');
    button.disabled = false; button.textContent = 'Simpan';
  }
});

document.getElementById('searchInput')?.addEventListener('input', event => { searchQuery = event.target.value; renderUsers(); });
document.querySelectorAll('.filter-tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.filter-tab').forEach(item => item.classList.remove('active'));
  tab.classList.add('active'); currentFilter = tab.dataset.filter; renderUsers();
}));

document.getElementById('manualUserForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(form));
    if (!await confirmUserAction('Buat user baru?', 'Peer WireGuard dan file config client akan dibuat untuk user ini.', 'Buat user', [`${payload.name} — ${payload.email} — ${payload.ip}`])) return;
    const data = await postJson('/api/users/manual', payload);
    notifyUser(data.message); form.reset(); await loadUsers();
  } catch (error) { notifyUser([error.message, ...(error.details || [])].join(' '), 'error'); }
  finally { button.disabled = false; }
});

document.getElementById('userCsvFile')?.addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  selectedCsvText = await file.text();
  document.querySelector('.file-picker span').textContent = file.name;
  document.getElementById('csvImportControls').hidden = false;
  document.getElementById('csvPreview').hidden = true;
});
document.getElementById('previewCsvButton')?.addEventListener('click', previewCsvImport);
document.getElementById('downloadSelectedConfigs')?.addEventListener('click', () => downloadConfigs([...selectedIps]));
document.getElementById('downloadAllConfigs')?.addEventListener('click', () => downloadConfigs(allUsers.map(user => user.ip_address)));

document.getElementById('restoreTemplateUsers')?.addEventListener('click', async event => {
  const current = await api('/api/users/manage/meta');
  const affected = (current?.users || []).map(user => `${user.name} — ${user.email} — ${user.ip}`);
  if (!await confirmUserAction('Pulihkan user awal?', 'Daftar dan peer user saat ini akan diganti dengan isi template awal; config VPN akan dibuat ulang.', 'Pulihkan user', affected)) return;
  const button = event.currentTarget; button.disabled = true;
  try { const data = await postJson('/api/users/restore-template', {}); notifyUser(data.message); await loadManageUsers(); }
  catch (error) { notifyUser([error.message, ...(error.details || [])].join(' '), 'error'); }
  finally { button.disabled = false; }
});

document.getElementById('deleteAllUsers')?.addEventListener('click', async event => {
  const current = await api('/api/users/manage/meta');
  const affected = (current?.users || []).map(user => `${user.name} — ${user.email} — ${user.ip}`);
  if (!affected.length) { notifyUser('Tidak ada user untuk dihapus.', 'error'); return; }
  if (!await confirmUserAction('Hapus semua user?', 'Peer WireGuard dan file config seluruh user di bawah akan dihapus. Akses VPN mereka langsung terputus.', 'Hapus semua', affected)) return;
  const button = event.currentTarget; button.disabled = true;
  try { const data = await postJson('/api/users/delete-all', {}); notifyUser(data.message); await loadManageUsers(); }
  catch (error) { notifyUser([error.message, ...(error.details || [])].join(' '), 'error'); }
  finally { button.disabled = false; }
});

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('manageUserList')) loadManageUsers();
  if (document.getElementById('userCardsGrid') || document.getElementById('newUserIp') || document.getElementById('exportUserList')) {
    loadUsers();
    setInterval(loadUsers, 15000);
  }
});
