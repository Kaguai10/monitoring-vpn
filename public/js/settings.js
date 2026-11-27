/**
 * Settings page
 */

let blockedDnsList = [];
let aiDnsList = [];
let aiBlockingEnabled = true;
let vpnInternetAccessEnabled = true;

async function loadSettings() {
  try {
    const data = await api('/api/settings');

    // Blocked DNS
    blockedDnsList = data.blockedDnsList || [];
    renderBlockedDnsTags();

    // AI DNS
    aiDnsList = data.aiDnsList || [];
    renderAiDnsTags();
    const aiToggle = document.getElementById('aiBlockingToggle');
    aiBlockingEnabled = data.aiBlockingEnabled !== false;
    if (aiToggle) aiToggle.checked = aiBlockingEnabled;
    const aiLabel = document.getElementById('aiBlockingLabel');
    if (aiLabel) aiLabel.textContent = aiBlockingEnabled ? 'Blokir AI' : 'Izinkan AI';

    const internetToggle = document.getElementById('vpnInternetToggle');
    vpnInternetAccessEnabled = data.vpnInternetAccessEnabled !== false;
    if (internetToggle) internetToggle.checked = vpnInternetAccessEnabled;
    renderVpnInternetAccessState();

    if (data.config) renderConfig(data.config);
    else document.getElementById('configList').innerHTML = '<p class="settings-load-error">Konfigurasi sistem tidak tersedia.</p>';

    // System info
    loadSystemInfo();
  } catch (err) {
    console.error('Settings error:', err);
    const configList = document.getElementById('configList');
    if (configList) configList.innerHTML = '<p class="settings-load-error">Gagal memuat konfigurasi. Muat ulang halaman setelah server diperbarui.</p>';
    const toggle = document.getElementById('aiBlockingToggle');
    if (toggle) toggle.disabled = true;
    const internetToggle = document.getElementById('vpnInternetToggle');
    if (internetToggle) internetToggle.disabled = true;
    const label = document.getElementById('aiBlockingLabel');
    if (label) label.textContent = 'Pengaturan belum termuat';
  }
}

function renderBlockedDnsTags() {
  const container = document.getElementById('blockedDnsTags');
  document.getElementById('blockedDnsCount').textContent = blockedDnsList.length;

  container.innerHTML = blockedDnsList.map((domain, i) => `
    <span class="dns-tag blocked">
      ${escapeHtml(domain)}
      <button class="dns-tag-remove" onclick="removeBlockedDns(${i})">&times;</button>
    </span>
  `).join('');
}

function renderAiDnsTags() {
  const container = document.getElementById('aiDnsTags');
  document.getElementById('aiDnsCount').textContent = aiDnsList.length;

  container.innerHTML = aiDnsList.map((entry, i) => {
    const domain = typeof entry === 'string' ? entry : entry.domain;
    const service = typeof entry === 'object' ? entry.service : domain;
    return `
      <span class="dns-tag ai">
        ${escapeHtml(service)} (${escapeHtml(domain)})
        <button class="dns-tag-remove" onclick="removeAiDns(${i})">&times;</button>
      </span>
    `;
  }).join('');
}

function renderConfig(config) {
  const container = document.getElementById('configList');
  container.classList.add('system-grid');
  container.innerHTML = [
    ['VPN Interface', config.wgInterface, 'Jaringan'],
    ['Polling WireGuard', `${config.pollInterval / 1000}s`, 'Monitoring'],
    ['Polling DNS', `${config.dnsPollInterval / 1000}s`, 'Monitoring'],
    ['Batas Offline', `${config.disconnectTimeout}s`, 'Koneksi'],
    ['Retensi Data', `${config.dataRetentionHours} jam`, `${Math.round(config.dataRetentionHours / 24)} hari`],
    ['Mode Aplikasi', config.demoMode ? 'DEMO' : 'REAL', 'Runtime'],
  ].map(([label, value, note]) => `<div class="system-info-tile"><span class="tile-label">${label}</span><strong>${value}</strong><span class="tile-note">${note}</span></div>`).join('');
}

async function loadSystemInfo() {
  try {
    const data = await api('/api/system');
    const container = document.getElementById('systemInfoList');
    const uptime = formatDuration(Math.floor(data.uptime));

    container.classList.add('system-grid');
    container.innerHTML = [
      ['Total User', data.totalPeers, `${data.connectedPeers} sedang online`],
      ['DNS Tercatat', data.totalDnsQueries.toLocaleString('id-ID'), 'Semua user'],
      ['Notifikasi', data.totalNotifications, `${data.unreadNotifications} belum dibaca`],
      ['Uptime', uptime, 'Server berjalan'],
      ['Node.js', data.nodeVersion, 'Runtime'],
      ['Mode', data.demoMode ? 'DEMO' : 'REAL', 'Aplikasi'],
    ].map(([label, value, note]) => `<div class="system-info-tile"><span class="tile-label">${label}</span><strong>${value}</strong><span class="tile-note">${note}</span></div>`).join('');
  } catch (err) {
    console.error('System info error:', err);
    const container = document.getElementById('systemInfoList');
    if (container) container.innerHTML = '<p class="settings-load-error">Gagal memuat info sistem.</p>';
  }
}

// Add blocked DNS
async function addBlockedDns() {
  const input = document.getElementById('newBlockedDns');
  const domain = input.value.trim().toLowerCase();
  if (!domain) return;
  if (blockedDnsList.includes(domain)) return notifyAction(`${domain} sudah ada di daftar blokir.`, 'blocked_dns');
  if (!await confirmAction({ title: 'Tambah DNS ke daftar blokir?', message: `User VPN tidak akan bisa mengakses ${domain} melalui DNS setelah aturan diterapkan.`, details: [domain], confirmLabel: 'Tambah domain' })) return;
  const next = [...blockedDnsList, domain];
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ blockedDnsList: next }) });
    blockedDnsList = next; input.value = ''; renderBlockedDnsTags();
    notifyAction(`${domain} ditambahkan ke daftar DNS blokir.`, 'blocked_dns');
  } catch (err) { notifyAction(`Gagal menambahkan ${domain}: ${err.message}`, 'blocked_dns'); }
}

// Remove blocked DNS
async function removeBlockedDns(index) {
  const domain = blockedDnsList[index];
  if (!domain || !await confirmAction({ title: 'Hapus DNS dari daftar blokir?', message: `User VPN akan bisa mengakses ${domain} lagi setelah perubahan diterapkan.`, details: [domain], confirmLabel: 'Hapus domain' })) return;
  const next = blockedDnsList.filter((_, i) => i !== index);
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ blockedDnsList: next }) });
    blockedDnsList = next; renderBlockedDnsTags(); notifyAction(`${domain} dihapus dari daftar DNS blokir.`, 'ai_access');
  } catch (err) { notifyAction(`Gagal menghapus ${domain}: ${err.message}`, 'blocked_dns'); }
}

// Add AI DNS
async function addAiDns() {
  const domainInput = document.getElementById('newAiDnsDomain');
  const serviceInput = document.getElementById('newAiDnsService');
  const domain = domainInput.value.trim().toLowerCase();
  const service = serviceInput.value.trim() || domain;
  if (!domain) return;

  if (aiDnsList.some(e => (typeof e === 'string' ? e : e.domain) === domain)) return notifyAction(`${domain} sudah ada di daftar AI.`, 'ai_access');
  const impact = aiBlockingEnabled ? 'Domain ini akan ikut diblokir bagi user VPN.' : 'Akses AI sedang diizinkan; domain hanya ditambahkan ke daftar pemantauan.';
  if (!await confirmAction({ title: 'Tambah layanan AI?', message: `${service} (${domain}) akan ditambahkan. ${impact}`, details: [`Layanan: ${service}`, `Domain: ${domain}`], confirmLabel: 'Tambah layanan', variant: 'primary' })) return;
  const next = [...aiDnsList, { domain, service }];
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ aiDnsList: next }) });
    aiDnsList = next; domainInput.value = ''; serviceInput.value = ''; renderAiDnsTags();
    notifyAction(`${service} ditambahkan ke daftar AI.`, 'ai_access');
  } catch (err) { notifyAction(`Gagal menambahkan ${service}: ${err.message}`, 'blocked_dns'); }
}

// Remove AI DNS
async function removeAiDns(index) {
  const entry = aiDnsList[index];
  if (!entry) return;
  const domain = typeof entry === 'string' ? entry : entry.domain;
  const service = typeof entry === 'string' ? entry : entry.service;
  const impact = aiBlockingEnabled ? `User VPN akan dapat mengakses ${domain} karena tidak lagi diblokir sebagai AI.` : 'Domain dihapus dari daftar pemantauan AI.';
  if (!await confirmAction({ title: 'Hapus layanan AI?', message: `${service} akan dihapus. ${impact}`, details: [`Layanan: ${service}`, `Domain: ${domain}`], confirmLabel: 'Hapus layanan' })) return;
  const next = aiDnsList.filter((_, i) => i !== index);
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ aiDnsList: next }) });
    aiDnsList = next; renderAiDnsTags(); notifyAction(`${service} dihapus dari daftar AI.`, 'ai_access');
  } catch (err) { notifyAction(`Gagal menghapus ${service}: ${err.message}`, 'blocked_dns'); }
}

async function setAiBlocking(enabled) {
  const toggle = document.getElementById('aiBlockingToggle');
  const previous = aiBlockingEnabled;
  toggle.disabled = true;
  const message = enabled
    ? `Seluruh domain dalam daftar AI (${aiDnsList.length} domain) akan diblokir bagi user VPN.`
    : 'User VPN akan diizinkan mengakses domain layanan AI dalam daftar.';
  if (!await confirmAction({ title: enabled ? 'Nyalakan blokir AI?' : 'Matikan blokir AI?', message, details: [`Domain dalam daftar: ${aiDnsList.length}`], confirmLabel: enabled ? 'Blokir AI' : 'Izinkan AI' })) {
    toggle.checked = previous; toggle.disabled = false; return;
  }
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ aiBlockingEnabled: enabled }) });
    aiBlockingEnabled = enabled;
    document.getElementById('aiBlockingLabel').textContent = enabled ? 'Blokir AI' : 'Izinkan AI';
    notifyAction(enabled ? 'Blokir AI dinyalakan.' : 'Akses AI sekarang diizinkan.', 'ai_access');
  } catch (err) {
    toggle.checked = previous;
    notifyAction(`Gagal mengubah akses AI: ${err.message}`, 'blocked_dns');
  } finally { toggle.disabled = false; }
}

function renderVpnInternetAccessState() {
  const state = vpnInternetAccessEnabled ? 'Internet user diizinkan' : 'Internet user diblokir';
  const title = document.getElementById('vpnInternetStateLabel');
  const label = document.getElementById('vpnInternetToggleLabel');
  if (title) title.textContent = state;
  if (label) label.textContent = vpnInternetAccessEnabled ? 'Diizinkan' : 'Diblokir';
}

async function setVpnInternetAccess(enabled) {
  const toggle = document.getElementById('vpnInternetToggle');
  const previous = vpnInternetAccessEnabled;
  toggle.disabled = true;
  const message = enabled
    ? 'Akses internet publik akan dinyalakan kembali untuk seluruh user VPN.'
    : 'Akses internet publik akan dimatikan untuk seluruh user VPN. Jaringan internal dan DNS VPN tetap dapat digunakan.';
  if (!await confirmAction({ title: enabled ? 'Nyalakan akses internet VPN?' : 'Matikan akses internet VPN?', message, confirmLabel: enabled ? 'Nyalakan akses' : 'Matikan akses' })) {
    toggle.checked = previous; toggle.disabled = false; return;
  }
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ vpnInternetAccessEnabled: enabled }) });
    vpnInternetAccessEnabled = enabled; renderVpnInternetAccessState();
    notifyAction(enabled ? 'Akses internet VPN dinyalakan.' : 'Akses internet VPN dimatikan.', enabled ? 'ai_access' : 'blocked_dns');
  } catch (err) {
    toggle.checked = previous;
    renderVpnInternetAccessState();
    notifyAction(`Gagal mengubah akses internet VPN: ${err.message}`, 'blocked_dns');
  } finally {
    toggle.disabled = false;
  }
}

// Change password
document.getElementById('changePasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const currentPwd = document.getElementById('currentPassword').value;
  const newPwd = document.getElementById('newPassword').value;
  const confirmPwd = document.getElementById('confirmPassword').value;
  const errorDiv = document.getElementById('pwdError');
  const successDiv = document.getElementById('pwdSuccess');

  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';

  if (newPwd !== confirmPwd) {
    errorDiv.textContent = 'Password baru dan konfirmasi tidak cocok';
    errorDiv.style.display = 'block';
    return;
  }

  if (newPwd.length < 12) {
    errorDiv.textContent = 'Password baru minimal 12 karakter';
    errorDiv.style.display = 'block';
    return;
  }

  if (!await confirmAction({ title: 'Ganti password admin?', message: 'Password baru akan langsung menggantikan password admin yang sekarang. Kamu harus menggunakan password baru pada login berikutnya.', confirmLabel: 'Ganti password', variant: 'primary' })) return;

  try {
    const res = await fetch('/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
    });
    const data = await res.json();

    if (res.ok && data.success) {
      successDiv.textContent = data.message;
      successDiv.style.display = 'block';
      document.getElementById('changePasswordForm').reset();
      notifyAction('Password admin berhasil diganti.', 'ai_access');
    } else {
      errorDiv.textContent = data.error || 'Gagal mengubah password';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    errorDiv.textContent = 'Koneksi gagal';
    errorDiv.style.display = 'block';
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// RESET DATA
// ============================================================
function showResetModal() {
  document.getElementById('resetModal').style.display = 'flex';
}

function hideResetModal() {
  document.getElementById('resetModal').style.display = 'none';
}

async function confirmReset() {
  try {
    await api('/api/reset', { method: 'POST' });
    // Reset lastNotifId agar toast tidak flood setelah reset
    localStorage.setItem('lastNotifId', '0');
    hideResetModal();
    alert('Data berhasil direset. Data VPN akan terisi otomatis dari WireGuard.');
    setTimeout(() => window.location.href = '/dashboard', 1000);
  } catch (err) {
    alert('Gagal reset: ' + err.message);
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
});
