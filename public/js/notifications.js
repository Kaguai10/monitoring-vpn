/**
 * Notifications page
 */

let currentNotifFilter = 'all';

async function loadNotifications() {
  const container = document.getElementById('notifList');
  try {
    const data = await api(`/api/notifications?type=${currentNotifFilter}&limit=200`);
    if (!data) return; // api() mengarahkan ke login, hentikan
    if (!Array.isArray(data.notifications)) {
      throw new Error('Respons daftar notifikasi tidak valid');
    }
    renderNotifications(data.notifications);
    updateLastUpdate();
  } catch (err) {
    console.error('Notifications error:', err);
    document.getElementById('noNotifs').style.display = 'none';
    container.innerHTML =
      '<div class="empty-state"><p>Gagal memuat notifikasi. Coba muat ulang halaman.</p></div>';
  }
}

function renderNotifications(notifications) {
  const container = document.getElementById('notifList');
  const noNotifs = document.getElementById('noNotifs');

  if (notifications.length === 0) {
    container.innerHTML = '';
    noNotifs.style.display = 'flex';
    return;
  }

  noNotifs.style.display = 'none';

  const typeConfig = {
    disconnect: {
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/></svg>',
      label: 'VPN Putus',
    },
    blocked_dns: {
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
      label: 'DNS Diblokir',
    },
    ai_access: {
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10A10 10 0 0 1 2 12 10 10 0 0 1 12 2z"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
      label: 'Akses AI',
    },
  };

  container.innerHTML = notifications.map(n => {
    const cfg = typeConfig[n.type] || typeConfig.disconnect;
    const isUnread = n.is_read === 0;

    return `
      <div class="notif-item ${isUnread ? 'unread' : ''}" ${isUnread ? `onclick="markRead(${n.id})"` : ''}>
        <div class="notif-icon ${n.type}">${cfg.icon}</div>
        <div class="notif-content">
          <div class="notif-message">${escapeHtml(n.message)}</div>
          <div class="notif-meta">
            <span class="notif-type-badge ${n.type}">${cfg.label}</span>
            <span class="notif-time">${escapeHtml(n.timeAgo || 'baru saja')}</span>
            <time class="notif-timestamp" datetime="${escapeHtml(n.timestamp || '')}">${escapeHtml(formatTime(n.timestamp))} WIB</time>
            ${n.peer_name ? `<span style="font-size:12px;color:var(--text-muted)">| ${escapeHtml(n.peer_name)}</span>` : ''}
          </div>
        </div>
        ${isUnread ? '<div class="notif-unread-dot"></div>' : ''}
      </div>
    `;
  }).join('');
}

async function markRead(id) {
  try {
    await api(`/api/notifications/${id}/read`, { method: 'PATCH' });
    notifyAction('Notifikasi ditandai sudah dibaca.', 'ai_access');
    loadNotifications();
  } catch (err) {
    console.error('Mark read error:', err);
  }
}

async function markAllRead() {
  try {
    const unread = await api('/api/notifications/unread-count');
    if (!unread?.count) return notifyAction('Tidak ada notifikasi yang belum dibaca.', 'ai_access');
    if (!await confirmAction({ title: 'Tandai semua notifikasi dibaca?', message: 'Status semua notifikasi yang belum dibaca akan diubah menjadi sudah dibaca.', details: [`Notifikasi terdampak: ${unread.count}`], confirmLabel: 'Tandai semua dibaca', variant: 'primary' })) return;
    await api('/api/notifications/read-all', { method: 'PATCH' });
    notifyAction(`${unread.count} notifikasi ditandai sudah dibaca.`, 'ai_access');
    loadNotifications();
  } catch (err) {
    console.error('Mark all read error:', err);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Filter tabs
document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentNotifFilter = tab.dataset.filter;
    loadNotifications();
  });
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadNotifications();
  setInterval(loadNotifications, 15000);
});
