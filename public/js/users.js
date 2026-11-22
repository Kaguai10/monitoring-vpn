/**
 * Users list page - kartak user yang terhubung VPN
 */

let allUsers = [];
let currentFilter = 'all';
let searchQuery = '';

async function loadUsers() {
  try {
    const data = await api('/api/users');
    allUsers = data.users;

    // Update count summary
    const summary = document.getElementById('usersSummary');
    if (summary) {
      summary.style.display = 'flex';
      document.getElementById('totalCount').textContent = data.total;
      document.getElementById('onlineCount').textContent = data.connected;
      document.getElementById('offlineCount').textContent = data.total - data.connected;
    }

    renderUsers();
    updateLastUpdate();
  } catch (err) {
    console.error('Users error:', err);
    document.getElementById('userCardsGrid').innerHTML =
      '<div class="empty-state"><p>Gagal memuat data user</p></div>';
  }
}

function renderUsers() {
  const grid = document.getElementById('userCardsGrid');
  const noUsers = document.getElementById('noUsers');

  // Filter
  let filtered = allUsers;
  if (currentFilter === 'connected') {
    filtered = filtered.filter(u => u.is_connected);
  } else if (currentFilter === 'disconnected') {
    filtered = filtered.filter(u => !u.is_connected);
  }

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.ip_address || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    noUsers.style.display = 'flex';
    return;
  }

  noUsers.style.display = 'none';

  grid.innerHTML = filtered.map(user => {
    const online = user.is_connected === 1;
    const strength = user.strength || 0;
    const sColor = strengthColor(strength);

    return `
      <a href="/users/${user.ip_address}" class="user-card ${online ? 'online' : 'offline'}">
        <div class="user-card-top">
          <div class="user-avatar" style="background: ${avatarColor(user.name || user.ip_address)}">
            ${initials(user.name || user.ip_address)}
          </div>
          <div class="user-card-info">
            <div class="user-card-name">${escapeHtml(user.name || 'Tanpa Nama')}</div>
            <div class="user-card-email">${escapeHtml(user.email || '-')}</div>
          </div>
          <div class="user-card-status ${online ? 'status-online' : 'status-offline'}">
            <span class="status-dot"></span>
            ${online ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>
        <div class="user-card-meta">
          <div class="user-meta-row">
            <span class="user-meta-label">IP Address</span>
            <span class="user-meta-value">${user.ip_address}</span>
          </div>
          <div class="user-meta-row">
            <span class="user-meta-label">Download</span>
            <span class="user-meta-value">${formatBytes(user.rx_bytes)}</span>
          </div>
          <div class="user-meta-row">
            <span class="user-meta-label">Upload</span>
            <span class="user-meta-value">${formatBytes(user.tx_bytes)}</span>
          </div>
          <div class="user-meta-row">
            <span class="user-meta-label">Handshake</span>
            <span class="user-meta-value">${user.lastHandshakeAgo}</span>
          </div>
        </div>
        <div class="strength-bar">
          <div class="strength-fill" style="width: ${strength}%; background: ${sColor};"></div>
        </div>
      </a>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Search
document.getElementById('searchInput')?.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderUsers();
});

// Filter tabs
document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    renderUsers();
  });
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadUsers();
  setInterval(loadUsers, 15000);
});
