/**
 * User preview/detail page
 */

let userDnsChart = null;
let userBandwidthChart = null;
let currentDnsFilter = 'all';
let peerIp = '';

async function loadUserDetail() {
  try {
    const data = await api(`/api/users/${peerIp}`);
    const peer = data.peer;
    const stats = data.stats;

    // Profile
    document.getElementById('previewTitle').textContent = peer.name || peer.ip_address;
    document.getElementById('profileName').textContent = peer.name || 'Tanpa Nama';
    document.getElementById('profileEmail').textContent = peer.email || '-';
    document.getElementById('profileAvatar').textContent = initials(peer.name || peer.ip_address);
    document.getElementById('profileAvatar').style.background = avatarColor(peer.name || peer.ip_address);

    const online = peer.is_connected === 1;
    const statusEl = document.getElementById('profileStatus');
    statusEl.textContent = online ? '● ONLINE' : '○ OFFLINE';
    statusEl.className = `badge badge-status ${online ? 'badge-green' : 'badge-red'}`;
    if (online) {
      statusEl.style.background = 'var(--success-dim)';
      statusEl.style.color = 'var(--success)';
    } else {
      statusEl.style.background = 'var(--danger-dim)';
      statusEl.style.color = 'var(--danger)';
    }

    const strengthEl = document.getElementById('profileStrength');
    strengthEl.textContent = `Sinyal: ${peer.strength}%`;

    document.getElementById('profileEndpoint').textContent = peer.endpoint || '-';
    document.getElementById('profileHandshake').textContent = peer.lastHandshakeAgo;
    document.getElementById('profileFirstSeen').textContent = formatTime(peer.first_seen);

    // Stats
    document.getElementById('statDnsTotal').textContent = stats.dnsTotal.toLocaleString('id-ID');
    document.getElementById('statDnsTotalSub').textContent = `${stats.dnsNormal} normal`;

    document.getElementById('statConnSuccess').textContent = stats.connectionSuccessRate + '%';
    document.getElementById('statConnSuccessSub').textContent = `total: ${stats.totalConnectedTime}`;

    document.getElementById('statRx').textContent = peer.rxFormatted;
    document.getElementById('statTxLabel').textContent = `Upload: ${peer.txFormatted}`;

    document.getElementById('statDnsBlocked').textContent = stats.dnsBlocked.toLocaleString('id-ID');
    document.getElementById('statDnsAiLabel').textContent = `AI: ${stats.dnsAi}`;

    // Counts for list headers
    document.getElementById('blockedCount').textContent = stats.dnsBlocked;
    document.getElementById('aiCount').textContent = stats.dnsAi;

    // Charts
    updateUserDnsChart(data.dnsTimeline);
    updateUserBandwidthChart(data.bandwidth);

    updateLastUpdate();
  } catch (err) {
    console.error('User detail error:', err);
  }
}

async function loadDnsList() {
  try {
    const data = await api(`/api/users/${peerIp}/dns?type=${currentDnsFilter}&limit=100`);
    renderDnsList(data.queries);
  } catch (err) {
    console.error('DNS list error:', err);
  }
}

async function loadBlockedDns() {
  try {
    const data = await api(`/api/users/${peerIp}/dns?type=blocked&limit=50`);
    renderBlockedList(data.queries);
  } catch (err) {
    console.error('Blocked DNS error:', err);
  }
}

async function loadAiDns() {
  try {
    const data = await api(`/api/users/${peerIp}/dns?type=ai&limit=50`);
    renderAiList(data.queries);
  } catch (err) {
    console.error('AI DNS error:', err);
  }
}

async function loadConnHistory() {
  try {
    const data = await api(`/api/users/${peerIp}/connections`);
    renderConnHistory(data.events);
  } catch (err) {
    console.error('Connection history error:', err);
  }
}

function renderDnsList(queries) {
  const container = document.getElementById('dnsListAll');

  if (queries.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px;"><p>Tidak ada DNS query</p></div>';
    return;
  }

  container.innerHTML = queries.map(q => {
    let type = 'normal';
    let icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    let extraTag = '';

    if (q.is_blocked) {
      type = 'blocked';
      icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
    } else if (q.is_ai) {
      type = 'ai';
      icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10A10 10 0 0 1 2 12 10 10 0 0 1 12 2z"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
      extraTag = `<span class="ai-service-tag">${escapeHtml(q.ai_service)}</span>`;
    }

    return `
      <div class="dns-item ${type}">
        <div class="dns-item-icon ${type}">${icon}</div>
        <div class="dns-item-content">
          <div class="dns-item-domain">${escapeHtml(q.domain)}</div>
          <div class="dns-item-meta">
            <span>${q.query_type}</span>
            ${extraTag}
          </div>
        </div>
        <div class="dns-item-time"><span>${escapeHtml(formatTime(q.timestamp))} WIB</span><span>${escapeHtml(q.timeAgo)}</span></div>
      </div>
    `;
  }).join('');
}

function renderBlockedList(queries) {
  const container = document.getElementById('dnsListBlocked');

  if (queries.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px;"><p>Tidak ada akses DNS diblokir</p></div>';
    return;
  }

  container.innerHTML = queries.map(q => `
    <div class="dns-item blocked">
      <div class="dns-item-icon blocked">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
      </div>
      <div class="dns-item-content">
        <div class="dns-item-domain">${escapeHtml(q.domain)}</div>
        <div class="dns-item-meta"><span>${q.query_type}</span></div>
      </div>
      <div class="dns-item-time"><span>${escapeHtml(formatTime(q.timestamp))} WIB</span><span>${escapeHtml(q.timeAgo)}</span></div>
    </div>
  `).join('');
}

function renderAiList(queries) {
  const container = document.getElementById('dnsListAi');

  if (queries.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px;"><p>Tidak ada akses AI</p></div>';
    return;
  }

  container.innerHTML = queries.map(q => `
    <div class="dns-item ai">
      <div class="dns-item-icon ai">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10A10 10 0 0 1 2 12 10 10 0 0 1 12 2z"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </div>
      <div class="dns-item-content">
        <div class="dns-item-domain">${escapeHtml(q.domain)}</div>
        <div class="dns-item-meta"><span class="ai-service-tag">${escapeHtml(q.ai_service)}</span></div>
      </div>
      <div class="dns-item-time"><span>${escapeHtml(formatTime(q.timestamp))} WIB</span><span>${escapeHtml(q.timeAgo)}</span></div>
    </div>
  `).join('');
}

function renderConnHistory(events) {
  const container = document.getElementById('connHistory');

  if (events.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px;"><p>Tidak ada riwayat koneksi</p></div>';
    return;
  }

  container.innerHTML = events.map(e => {
    const isConnect = e.event_type === 'connect';
    const icon = isConnect
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`;

    return `
      <div class="conn-event ${e.event_type}">
        <div class="conn-event-icon">${icon}</div>
        <div class="conn-event-content">
          <div class="conn-event-title">${isConnect ? 'Terhubung ke VPN' : 'Terputus dari VPN'}</div>
          <div class="conn-event-detail">
            ${e.durationFormatted ? `<span>Durasi: ${e.durationFormatted}</span>` : ''}
            <span>RX: ${e.rxFormatted}</span>
            <span>TX: ${e.txFormatted}</span>
          </div>
        </div>
        <div class="conn-event-time">${escapeHtml(formatTime(e.timestamp))} WIB</div>
      </div>
    `;
  }).join('');
}

function updateUserDnsChart(timeline) {
  const ctx = document.getElementById('userDnsChart');
  if (!ctx) return;

  const labels = timeline.map(t => t.time_label);
  const counts = timeline.map(t => t.count);

  if (userDnsChart) {
    userDnsChart.data.labels = labels;
    userDnsChart.data.datasets[0].data = counts;
    userDnsChart.update('none');
    return;
  }

  userDnsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'DNS Requests',
        data: counts,
        borderColor: '#00d4ff',
        backgroundColor: (ctx) => {
          const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 240);
          gradient.addColorStop(0, 'rgba(0, 212, 255, 0.2)');
          gradient.addColorStop(1, 'rgba(0, 212, 255, 0)');
          return gradient;
        },
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(42, 52, 65, 0.5)' }, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function updateUserBandwidthChart(bandwidth) {
  const ctx = document.getElementById('userBandwidthChart');
  if (!ctx) return;

  const labels = bandwidth.map(b => formatClockTime(b.timestamp));
  const rxData = bandwidth.map(b => b.rx_rate);
  const txData = bandwidth.map(b => b.tx_rate);

  if (userBandwidthChart) {
    userBandwidthChart.data.labels = labels;
    userBandwidthChart.data.datasets[0].data = rxData;
    userBandwidthChart.data.datasets[1].data = txData;
    userBandwidthChart.update('none');
    return;
  }

  userBandwidthChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Download (RX)',
          data: rxData,
          borderColor: '#3fb950',
          backgroundColor: 'rgba(63, 185, 80, 0.1)',
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
        {
          label: 'Upload (TX)',
          data: txData,
          borderColor: '#00d4ff',
          backgroundColor: 'rgba(0, 212, 255, 0.1)',
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { padding: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${formatBytes(ctx.parsed.y)}/s`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: {
          grid: { color: 'rgba(42, 52, 65, 0.5)' },
          beginAtZero: true,
          ticks: {
            callback: (val) => formatBytes(val) + '/s',
          },
        },
      },
    },
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// DNS filter tabs
document.querySelectorAll('.dns-filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.dns-filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentDnsFilter = tab.dataset.type;
    loadDnsList();
  });
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  peerIp = document.getElementById('peerIp').value;
  loadUserDetail();
  loadDnsList();
  loadBlockedDns();
  loadAiDns();
  loadConnHistory();
  setInterval(() => {
    loadUserDetail();
    loadDnsList();
    loadBlockedDns();
    loadAiDns();
    loadConnHistory();
  }, 15000);
});
