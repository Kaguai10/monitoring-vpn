/**
 * Common utilities untuk semua halaman
 */

// API fetch helper dengan error handling
async function api(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Jika di-redirect (mis. session expired -> 302 ke /login), arahkan ke login
    if (res.redirected) {
      window.location.href = '/login';
      return null;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      // Respons bukan JSON (kemungkinan HTML error page atau redirect)
      if (res.status === 401) {
        window.location.href = '/login';
        return null;
      }
      throw new Error(`HTTP ${res.status}: Respons server tidak valid`);
    }

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    if (err.message === 'Unauthorized' || err.message.includes('401')) {
      window.location.href = '/login';
      return null;
    }
    throw err;
  }
}

// Logout
async function logout() {
  try {
    await fetch('/logout', { method: 'POST' });
  } catch (e) { /* ignore */ }
  window.location.href = '/login';
}

// Toggle sidebar (mobile)
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('mobileOverlay').classList.toggle('show');
}

// Format bytes ke human readable
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format durasi
function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}j ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Time ago
function timeAgo(timestamp) {
  if (!timestamp) return '-';
  const value = typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(timestamp)
    ? `${timestamp.replace(' ', 'T')}Z`
    : timestamp;
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff) || diff <= 5000) return 'baru saja';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'baru saja';
  if (seconds < 60) return `${seconds} detik lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

// Format timestamp
function formatTime(timestamp) {
  if (!timestamp) return '-';
  const value = typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(timestamp)
    ? `${timestamp.replace(' ', 'T')}Z`
    : timestamp;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '-';
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZone: 'Asia/Jakarta',
  });
}

function formatClockTime(timestamp) {
  if (!timestamp) return '-';
  const value = typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(timestamp)
    ? `${timestamp.replace(' ', 'T')}Z`
    : timestamp;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '-';
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta',
  });
}

// Avatar color berdasarkan nama
function avatarColor(name) {
  const colors = [
    ['#00d4ff', '#0099cc'],
    ['#3fb950', '#2da44e'],
    ['#bc8cff', '#9a6fff'],
    ['#f85149', '#da3633'],
    ['#d29922', '#bb6700'],
    ['#58a6ff', '#388bfd'],
    ['#ff7b72', '#da3633'],
    ['#79c0ff', '#4493f8'],
    ['#a5d6ff', '#79c0ff'],
    ['#7ee787', '#3fb950'],
  ];
  let hash = 0;
  const str = name || 'unknown';
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return `linear-gradient(135deg, ${colors[index][0]}, ${colors[index][1]})`;
}

// Initial huruf
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

// Strength color
function strengthColor(strength) {
  if (strength >= 80) return 'var(--success)';
  if (strength >= 50) return 'var(--warning)';
  if (strength >= 20) return '#f0883e';
  return 'var(--danger)';
}

// Update badge notifikasi di navbar + toast untuk notif baru
let lastNotifId = parseInt(localStorage.getItem('lastNotifId') || '0');
let notifInitialized = false;

async function pollNotifications() {
  try {
    const data = await api('/api/notifications?limit=10');
    const badge = document.getElementById('nav-notif-badge');

    if (data.notifications && data.notifications.length > 0) {
      const newestId = data.notifications[0].id;

      if (!notifInitialized) {
        // First load - set baseline, don't show toasts
        lastNotifId = newestId;
        localStorage.setItem('lastNotifId', newestId);
        notifInitialized = true;
      } else if (newestId > lastNotifId) {
        // New notifications! Show toasts for each new one
        const newNotifs = data.notifications.filter(n => n.id > lastNotifId);
        newNotifs.reverse().forEach(n => {
          // Pop-up/toast hanya untuk akses AI. Notifikasi lain (disconnect,
          // blocked_dns, dll) tetap tersimpan di halaman notifikasi tapi
          // tidak memunculkan pop-up.
          if (n.type === 'ai_access') {
            showToast(n);
            showBrowserNotification(n);
          }
        });
        lastNotifId = newestId;
        localStorage.setItem('lastNotifId', newestId);
      }
    }

    // Update badge
    const unreadData = await api('/api/notifications/unread-count');
    if (badge) {
      if (unreadData.count > 0) {
        badge.textContent = unreadData.count > 99 ? '99+' : unreadData.count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (e) { /* ignore */ }
}

// ============================================================
// TOAST NOTIFICATIONS (muncul dari kanan bawah)
// ============================================================

const TOAST_ICONS = {
  disconnect: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  blocked_dns: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  ai_access: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10A10 10 0 0 1 2 12 10 10 0 0 1 12 2z"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
};

function showToast(notification) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${notification.type}`;
  toast.onclick = () => dismissToast(toast);

  const icon = TOAST_ICONS[notification.type] || TOAST_ICONS.disconnect;

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-message">${escapeHtml(notification.message)}</div>
      <div class="toast-time">${notification.timeAgo || 'baru saja'}</div>
    </div>
  `;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add('toast-show'));

  // Auto dismiss after 6 seconds
  setTimeout(() => dismissToast(toast), 6000);
}

function dismissToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.remove('toast-show');
  toast.classList.add('toast-hide');
  setTimeout(() => toast.remove(), 300);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// BROWSER PUSH NOTIFICATIONS (Notification API)
// ============================================================

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showBrowserNotification(notification) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const typeLabels = {
    disconnect: 'VPN Putus',
    blocked_dns: 'DNS Diblokir',
    ai_access: 'Akses AI',
  };

  const n = new Notification('VPN Monitor - ' + (typeLabels[notification.type] || 'Notifikasi'), {
    body: notification.message,
    icon: '/favicon.ico',
    tag: 'vpn-monitor-' + notification.id,
  });

  // Auto close after 6 seconds
  setTimeout(() => n.close(), 6000);

  // Click to focus window
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

// Update last update time
function updateLastUpdate() {
  const el = document.getElementById('lastUpdate');
  if (el) {
    const now = new Date();
    el.textContent = 'Update: ' + now.toLocaleTimeString('id-ID');
  }
}

// Chart defaults
function setChartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = '#8b949e';
  Chart.defaults.borderColor = '#2a3441';
  Chart.defaults.font.family = 'Inter, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.padding = 16;
  Chart.defaults.plugins.tooltip.backgroundColor = '#0f141c';
  Chart.defaults.plugins.tooltip.borderColor = '#2a3441';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.titleColor = '#e6edf3';
  Chart.defaults.plugins.tooltip.bodyColor = '#8b949e';
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
}

// Init on load
document.addEventListener('DOMContentLoaded', () => {
  setChartDefaults();
  pollNotifications();
  setInterval(pollNotifications, 10000);
  requestNotificationPermission();
});
