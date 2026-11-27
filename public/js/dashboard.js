/**
 * Dashboard page - charts dan data real-time
 */

let dnsTrafficChart = null;
let vpnStatusChart = null;
let topDnsChart = null;
let refreshInterval = null;

async function loadDashboard() {
  try {
    const data = await api('/api/dashboard');

    // Stats
    document.getElementById('statTotalSlots').textContent = data.totalPeers;
    document.getElementById('statTotalSlotsSub').textContent = `${data.totalPeers} peer terdaftar`;

    document.getElementById('statConnected').textContent = data.connectedPeers;
    document.getElementById('statConnectedSub').textContent = `${data.disconnectedPeers} offline`;

    document.getElementById('statStrength').textContent = data.avgStrength + '%';
    document.getElementById('statStrengthSub').textContent = data.avgStrength >= 80 ? 'sangat baik' : data.avgStrength >= 50 ? 'cukup' : 'lemah';

    document.getElementById('statDnsToday').textContent = data.dnsTotalToday.toLocaleString('id-ID');
    document.getElementById('statDnsTodaySub').textContent = `${data.dnsBlockedToday} diblokir, ${data.dnsAiToday} AI`;

    // Summary
    const dnsNormal = data.dnsTotalToday - data.dnsBlockedToday - data.dnsAiToday;
    document.getElementById('summaryDnsNormal').textContent = dnsNormal.toLocaleString('id-ID');
    document.getElementById('summaryDnsBlocked').textContent = data.dnsBlockedToday.toLocaleString('id-ID');
    document.getElementById('summaryDnsAi').textContent = data.dnsAiToday.toLocaleString('id-ID');
    document.getElementById('summaryTotalRx').textContent = data.totalRxFormatted;
    document.getElementById('summaryTotalTx').textContent = data.totalTxFormatted;

    // DNS rate badge
    const totalReq = data.dnsTimeline.reduce((sum, item) => sum + item.count, 0);
    const avgRate = data.dnsTimeline.length > 0 ? Math.round(totalReq / data.dnsTimeline.length) : 0;
    document.getElementById('dnsRateBadge').textContent = avgRate + ' req/menit';

    // Donut center
    document.getElementById('donutValue').textContent = data.connectedPeers;

    // Charts
    updateDnsTrafficChart(data.dnsTimeline);
    updateVpnStatusChart(data);
    updateTopDnsChart(data.topDns);

    updateLastUpdate();
  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

function updateDnsTrafficChart(timeline) {
  const ctx = document.getElementById('dnsTrafficChart');
  if (!ctx) return;

  const labels = timeline.map(t => t.time_label);
  const counts = timeline.map(t => t.count);

  if (dnsTrafficChart) {
    dnsTrafficChart.data.labels = labels;
    dnsTrafficChart.data.datasets[0].data = counts;
    dnsTrafficChart.update('none');
    return;
  }

  dnsTrafficChart = new Chart(ctx, {
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
        pointHoverBackgroundColor: '#00d4ff',
        pointHoverBorderColor: '#0a0e14',
        pointHoverBorderWidth: 2,
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

function updateVpnStatusChart(data) {
  const ctx = document.getElementById('vpnStatusChart');
  if (!ctx) return;

  if (vpnStatusChart) {
    vpnStatusChart.data.datasets[0].data = [data.connectedPeers, data.disconnectedPeers];
    vpnStatusChart.update('none');
    return;
  }

  vpnStatusChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Online', 'Offline'],
      datasets: [{
        data: [data.connectedPeers, data.disconnectedPeers],
        backgroundColor: ['#3fb950', '#2a3441'],
        borderColor: '#131a24',
        borderWidth: 3,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 16, font: { size: 12 } },
        },
      },
    },
  });
}

function updateTopDnsChart(topDns) {
  const ctx = document.getElementById('topDnsChart');
  if (!ctx) return;

  const labels = topDns.map(d => d.domain);
  const counts = topDns.map(d => d.count);
  const colors = ['#00d4ff', '#58a6ff', '#bc8cff', '#3fb950', '#d29922'];

  if (topDnsChart) {
    topDnsChart.data.labels = labels;
    topDnsChart.data.datasets[0].data = counts;
    topDnsChart.update('none');
    return;
  }

  topDnsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: counts,
        backgroundColor: colors,
        borderRadius: 6,
        borderSkipped: false,
        barThickness: 'flex',
        maxBarThickness: 40,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.x} requests`,
          },
        },
      },
      scales: {
        x: { grid: { color: 'rgba(42, 52, 65, 0.5)' }, beginAtZero: true, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
    },
  });
}

// Auto-refresh
document.getElementById('autoRefresh')?.addEventListener('change', (e) => {
  if (e.target.checked) {
    refreshInterval = setInterval(loadDashboard, 10000);
  } else {
    clearInterval(refreshInterval);
  }
});

// ============================================================
// MONITOR CONTROL (Start/Stop monitoring)
// ============================================================

async function loadMonitorStatus() {
  try {
    const data = await api('/api/monitor/status');
    updateMonitorUI(data.active);
  } catch (e) { /* ignore */ }
}

function updateMonitorUI(active) {
  const status = document.getElementById('monitorStatusText');
  const btn = document.getElementById('monitorBtn');
  if (!status || !btn) return;

  if (active) {
    status.innerHTML = '<span class="monitor-dot monitor-dot-active"></span><span>Active</span>';
    status.style.color = 'var(--success)';
    btn.textContent = 'Stop';
    btn.className = 'btn-monitor btn-monitor-stop';
  } else {
    status.innerHTML = '<span class="monitor-dot monitor-dot-paused"></span><span>Paused</span>';
    status.style.color = 'var(--text-muted)';
    btn.textContent = 'Start';
    btn.className = 'btn-monitor btn-monitor-start';
  }
}

async function toggleMonitor() {
  try {
    const data = await api('/api/monitor/status');
    if (data.active) {
      if (!await confirmAction({ title: 'Hentikan monitoring?', message: 'Pemantauan koneksi WireGuard dan aktivitas DNS akan berhenti sampai monitoring dinyalakan lagi.', confirmLabel: 'Hentikan monitoring' })) return;
      await api('/api/monitor/stop', { method: 'POST' });
      updateMonitorUI(false);
      notifyAction('Monitoring dihentikan.', 'blocked_dns');
    } else {
      if (!await confirmAction({ title: 'Nyalakan monitoring?', message: 'Pemantauan koneksi WireGuard dan aktivitas DNS akan berjalan kembali.', confirmLabel: 'Nyalakan monitoring', variant: 'primary' })) return;
      await api('/api/monitor/start', { method: 'POST' });
      updateMonitorUI(true);
      loadDashboard(); // Refresh data immediately after starting
      notifyAction('Monitoring dinyalakan.', 'ai_access');
    }
  } catch (e) {
    console.error('Monitor toggle error:', e);
    notifyAction(`Gagal mengubah monitoring: ${e.message}`, 'blocked_dns');
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  loadMonitorStatus();
  refreshInterval = setInterval(loadDashboard, 10000);
  setInterval(loadMonitorStatus, 5000); // Check monitor status every 5s
});
