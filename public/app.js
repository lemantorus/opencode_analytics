const API_BASE = '/api';
let checkAsFree = true;
let currentRange = 30;
let useCustomRange = false;
let customStart = null;
let customEnd = null;
let charts = {};
let modelsData = [];
let tpsModelsList = [];
let selectedTPSModels = [];
let currentChartType = 'tokens';
let currentHourlyType = 'messages';

function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString();
}

function formatCurrency(num) {
  if (num >= 100) return '$' + num.toFixed(0);
  if (num >= 10) return '$' + num.toFixed(1);
  if (num >= 1) return '$' + num.toFixed(2);
  if (num >= 0.01) return '$' + num.toFixed(3);
  return '$' + num.toFixed(4);
}

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const chartColors = [
  '#00ff88', '#00d4aa', '#00aaff', '#aa88ff', '#ff8844',
  '#ff44aa', '#88ff00', '#ffcc00', '#ff4444', '#44ffff',
  '#ff8800', '#00ffcc', '#cc44ff', '#88ff44', '#ff6688'
];

function getColor(index) {
  return chartColors[index % chartColors.length];
}

const tooltipDefaults = {
  backgroundColor: 'rgba(10, 10, 10, 0.95)',
  titleColor: '#00ff88',
  bodyColor: '#e0e0e0',
  borderColor: '#00ff88',
  borderWidth: 1,
  padding: 12,
  cornerRadius: 6,
  titleFont: { size: 12, weight: '600', family: 'JetBrains Mono, monospace' },
  bodyFont: { size: 11, family: 'JetBrains Mono, monospace' },
  displayColors: true,
  boxWidth: 10,
  boxHeight: 10,
  boxPadding: 4,
  usePointStyle: true,
  animation: { duration: 150 },
  caretSize: 6,
  caretPadding: 8
};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        color: '#888888',
        boxWidth: 12,
        padding: 16,
        font: { size: 10, family: 'JetBrains Mono, monospace' },
        usePointStyle: true,
        pointStyle: 'rectRounded'
      }
    },
    tooltip: {
      ...tooltipDefaults,
      callbacks: {
        label: function(context) {
          const value = context.raw;
          const label = context.dataset.label || '';
          if (label.toLowerCase().includes('cost')) {
            return `${label}: ${formatCurrency(value)}`;
          }
          return `${label}: ${formatNumber(value)}`;
        }
      }
    }
  },
  scales: {
    x: {
      ticks: { 
        color: '#555555', 
        font: { size: 9, family: 'JetBrains Mono, monospace' }
      },
      grid: { color: '#1a1a1a', drawBorder: false }
    },
    y: {
      ticks: { 
        color: '#555555', 
        font: { size: 9, family: 'JetBrains Mono, monospace' }
      },
      grid: { color: '#1a1a1a', drawBorder: false }
    }
  },
  animation: {
    duration: 300
  }
};

async function fetchAPI(endpoint) {
  const url = `${API_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}checkAsFree=${checkAsFree}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API Error: ${res.status}`);
  return res.json();
}

async function loadOverview() {
  const days = useCustomRange ? null : (currentRange === 'all' ? null : currentRange);
  const queryParam = days ? `?days=${days}` : '';
  const data = await fetchAPI(`/stats/overview${queryParam}`);
  
  document.getElementById('totalMessages').textContent = formatNumber(data.messageCount);
  document.getElementById('totalInput').textContent = formatNumber(data.totalInput);
  document.getElementById('totalOutput').textContent = formatNumber(data.totalOutput);
  document.getElementById('totalCacheRead').textContent = formatNumber(data.totalCacheRead);
  document.getElementById('totalCost').textContent = formatCurrency(data.totalCost);
}

async function loadModelsChart() {
  const days = useCustomRange ? 365 : (currentRange === 'all' ? 365 : currentRange);
  modelsData = await fetchAPI(`/stats/models?days=${days}`);
  
  const topModels = modelsData.slice(0, 8);
  const labels = topModels.map(m => m.baseModel);
  
  if (charts.models) charts.models.destroy();
  
  const ctx = document.getElementById('modelsChart').getContext('2d');
  charts.models = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Input',
          data: topModels.map(m => m.inputTokens),
          backgroundColor: getColor(0),
          borderRadius: 3,
          barPercentage: 0.7
        },
        {
          label: 'Output',
          data: topModels.map(m => m.outputTokens),
          backgroundColor: getColor(1),
          borderRadius: 3,
          barPercentage: 0.7
        },
        {
          label: 'Cache Read',
          data: topModels.map(m => m.cacheRead),
          backgroundColor: getColor(2),
          borderRadius: 3,
          barPercentage: 0.7
        },
        {
          label: 'Cache Write',
          data: topModels.map(m => m.cacheWrite),
          backgroundColor: getColor(3),
          borderRadius: 3,
          barPercentage: 0.7
        }
      ]
    },
    options: {
      ...chartDefaults,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        ...chartDefaults.plugins,
        tooltip: {
          ...tooltipDefaults,
          mode: 'index',
          intersect: false,
          callbacks: {
            label: function(context) {
              const value = context.raw;
              return `${context.dataset.label}: ${formatNumber(value)}`;
            }
          }
        }
      },
      scales: {
        x: { ...chartDefaults.scales.x, stacked: true },
        y: { 
          ...chartDefaults.scales.y, 
          stacked: true,
          ticks: { 
            ...chartDefaults.scales.y.ticks, 
            callback: v => formatNumber(v)
          }
        }
      }
    }
  });
  
  if (charts.cost) charts.cost.destroy();
  
  const ctxCost = document.getElementById('costChart').getContext('2d');
  charts.cost = new Chart(ctxCost, {
    type: 'doughnut',
    data: {
      labels: topModels.map(m => m.baseModel),
      datasets: [{
        data: topModels.map(m => m.cost),
        backgroundColor: topModels.map((_, i) => getColor(i)),
        borderWidth: 2,
        borderColor: '#0d0d0d',
        hoverOffset: 8,
        hoverBorderWidth: 2,
        hoverBorderColor: '#00ff88'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: { 
            color: '#888888', 
            boxWidth: 10, 
            padding: 8, 
            font: { size: 9, family: 'JetBrains Mono, monospace' },
            usePointStyle: true
          }
        },
        tooltip: {
          ...tooltipDefaults,
          callbacks: {
            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}`
          }
        }
      }
    }
  });
  
  updateModelsTable();
}

async function loadDailyChart(showCost = false) {
  let data;
  
  if (useCustomRange && customStart && customEnd) {
    data = await fetchAPI(`/stats/daily/range?start=${customStart}&end=${customEnd}`);
  } else {
    const days = currentRange === 'all' ? 365 : currentRange;
    data = await fetchAPI(`/stats/daily?days=${days}`);
  }
  
  if (charts.daily) charts.daily.destroy();
  
  const ctx = document.getElementById('dailyChart').getContext('2d');
  
  if (showCost) {
    charts.daily = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => d.time),
        datasets: [{
          label: 'Cost',
          data: data.map(d => d.cost),
          borderColor: getColor(0),
          backgroundColor: 'rgba(0, 255, 136, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          pointBackgroundColor: getColor(0),
          pointBorderColor: '#0a0a0a',
          pointBorderWidth: 1,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: getColor(0),
          pointHoverBorderColor: '#00ff88',
          pointHoverBorderWidth: 2,
          borderWidth: 2
        }]
      },
      options: {
        ...chartDefaults,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: { 
          legend: { display: false },
          tooltip: {
            ...tooltipDefaults,
            mode: 'index',
            intersect: false,
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => `Cost: ${formatCurrency(ctx.raw)}`
            }
          }
        },
        scales: {
          x: { 
            ...chartDefaults.scales.x, 
            ticks: { ...chartDefaults.scales.x.ticks, maxTicksLimit: 10 } 
          },
          y: { 
            ...chartDefaults.scales.y, 
            ticks: { ...chartDefaults.scales.y.ticks, callback: v => formatCurrency(v) } 
          }
        }
      }
    });
  } else {
    charts.daily = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => d.time),
        datasets: [
          {
            label: 'Input',
            data: data.map(d => d.inputTokens),
            borderColor: getColor(0),
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 2,
            pointBackgroundColor: getColor(0),
            pointBorderColor: '#0a0a0a',
            pointBorderWidth: 1,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: getColor(0),
            pointHoverBorderColor: '#00ff88',
            pointHoverBorderWidth: 2,
            borderWidth: 2
          },
          {
            label: 'Output',
            data: data.map(d => d.outputTokens),
            borderColor: getColor(1),
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 2,
            pointBackgroundColor: getColor(1),
            pointBorderColor: '#0a0a0a',
            pointBorderWidth: 1,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: getColor(1),
            pointHoverBorderColor: '#00ff88',
            pointHoverBorderWidth: 2,
            borderWidth: 2
          },
          {
            label: 'Cache Read',
            data: data.map(d => d.cacheRead),
            borderColor: getColor(2),
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 2,
            pointBackgroundColor: getColor(2),
            pointBorderColor: '#0a0a0a',
            pointBorderWidth: 1,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: getColor(2),
            pointHoverBorderColor: '#00ff88',
            pointHoverBorderWidth: 2,
            borderWidth: 2
          }
        ]
      },
      options: {
        ...chartDefaults,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: '#888888',
              boxWidth: 10,
              padding: 12,
              font: { size: 9, family: 'JetBrains Mono, monospace' },
              usePointStyle: true
            }
          },
          tooltip: {
            ...tooltipDefaults,
            mode: 'index',
            intersect: false,
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${formatNumber(context.raw)}`;
              }
            }
          }
        },
        scales: {
          x: { 
            ...chartDefaults.scales.x, 
            ticks: { ...chartDefaults.scales.x.ticks, maxTicksLimit: 10 } 
          },
          y: { 
            ...chartDefaults.scales.y, 
            ticks: { ...chartDefaults.scales.y.ticks, callback: v => formatNumber(v) } 
          }
        }
      }
    });
  }
}

async function loadHourlyChart(mode = 'messages') {
  let data;
  if (mode === 'tps') {
    data = await fetchAPI('/stats/hourly-tps');
  } else {
    data = await fetchAPI('/stats/hourly');
  }
  
  if (charts.hourly) charts.hourly.destroy();
  
  const ctx = document.getElementById('hourlyChart').getContext('2d');
  
  if (mode === 'tps') {
    charts.hourly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => `${d.hour.toString().padStart(2, '0')}`),
        datasets: [{
          label: 'Output TPS',
          data: data.map(d => d.outputTPS),
          backgroundColor: data.map((d, i) => d.isToday ? getColor(0) : getColor(0) + '40'),
          borderRadius: 2,
          barPercentage: 0.8
        }]
      },
      options: {
        ...chartDefaults,
        plugins: { 
          legend: { display: false },
          tooltip: {
            ...tooltipDefaults,
            callbacks: {
              title: (items) => `Hour ${items[0].label}:00`,
              label: (ctx) => `Output TPS: ${ctx.raw.toFixed(2)} tok/s`
            }
          }
        },
        scales: {
          ...chartDefaults.scales,
          y: {
            ...chartDefaults.scales.y,
            ticks: {
              ...chartDefaults.scales.y.ticks,
              callback: v => v.toFixed(1)
            }
          }
        }
      }
    });
  } else {
    charts.hourly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => `${d.hour.toString().padStart(2, '0')}`),
        datasets: [{
          label: 'Messages',
          data: data.map(d => d.messageCount),
          backgroundColor: data.map((_, i) => {
            const hour = data[i].hour;
            return (hour >= 9 && hour <= 18) ? getColor(0) : getColor(0) + '40';
          }),
          borderRadius: 2,
          barPercentage: 0.8
        }]
      },
      options: {
        ...chartDefaults,
        plugins: { 
          legend: { display: false },
          tooltip: {
            ...tooltipDefaults,
            callbacks: {
              title: (items) => `Hour ${items[0].label}:00`,
              label: (ctx) => `Messages: ${formatNumber(ctx.raw)}`
            }
          }
        }
      }
    });
  }
}

async function loadWeeklyChart() {
  const data = await fetchAPI('/stats/weekly?weeks=12');
  
  if (charts.weekly) charts.weekly.destroy();
  
  const ctx = document.getElementById('weeklyChart').getContext('2d');
  charts.weekly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => (d.week || d.time || '').split('-')[1] || d.week || d.time),
      datasets: [{
        label: 'Cost',
        data: data.map(d => d.cost),
        backgroundColor: getColor(4),
        borderRadius: 3,
        barPercentage: 0.6,
        hoverBackgroundColor: getColor(0)
      }]
    },
    options: {
      ...chartDefaults,
      plugins: { 
        legend: { display: false },
        tooltip: {
          ...tooltipDefaults,
          callbacks: {
            label: (ctx) => `Cost: ${formatCurrency(ctx.raw)}`
          }
        }
      },
      scales: {
        ...chartDefaults.scales,
        y: { 
          ...chartDefaults.scales.y, 
          ticks: { 
            ...chartDefaults.scales.y.ticks, 
            callback: v => formatCurrency(v) 
          } 
        }
      }
    }
  });
}

async function loadTPSModelsList() {
  const modelsWithStats = await fetchAPI('/stats/models?days=30');
  
  modelsWithStats.sort((a, b) => (b.outputTokens || 0) - (a.outputTokens || 0));
  tpsModelsList = modelsWithStats.slice(0, 10).map(m => m.baseModel);
  selectedTPSModels = tpsModelsList.slice(0, 5);
  
  const dropdown = document.getElementById('tpsModelDropdown');
  const optionsContainer = dropdown.querySelector('.dropdown-options');
  optionsContainer.innerHTML = '';
  
  for (const model of tpsModelsList) {
    const label = document.createElement('label');
    label.className = 'dropdown-option' + (selectedTPSModels.includes(model) ? ' selected' : '');
    label.innerHTML = `
      <input type="checkbox" value="${model}" ${selectedTPSModels.includes(model) ? 'checked' : ''}>
      ${model}
    `;
    optionsContainer.appendChild(label);
  }
  
  updateDropdownButton();
}

function updateDropdownButton() {
  const dropdown = document.getElementById('tpsModelDropdown');
  const btn = dropdown.querySelector('.dropdown-toggle');
  const checked = dropdown.querySelectorAll('input[type="checkbox"]:checked');
  
  if (checked.length === 0) {
    btn.textContent = 'Select models ▼';
  } else if (checked.length <= 2) {
    const labels = Array.from(checked).map(c => c.value);
    btn.textContent = labels.join(', ') + ' ▼';
  } else {
    btn.textContent = `${checked.length} models selected ▼`;
  }
}

function initTPSDropdown() {
  const dropdown = document.getElementById('tpsModelDropdown');
  const btn = dropdown.querySelector('.dropdown-toggle');
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  
  dropdown.querySelector('.dropdown-options').addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') {
      const label = e.target.closest('.dropdown-option');
      if (e.target.checked) {
        label.classList.add('selected');
      } else {
        label.classList.remove('selected');
      }
      updateDropdownButton();
    }
  });
  
  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
  });
  
  dropdown.querySelector('.dropdown-menu').addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  setTimeout(() => {
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn btn-sm btn-primary';
    applyBtn.textContent = 'Apply';
    applyBtn.style.marginTop = '0.5rem';
    applyBtn.style.width = '100%';
    applyBtn.addEventListener('click', async () => {
      dropdown.classList.remove('open');
      const checked = dropdown.querySelectorAll('input[type="checkbox"]:checked');
      selectedTPSModels = Array.from(checked).map(c => c.value);
      await loadTPSChart();
    });
    dropdown.querySelector('.dropdown-menu').appendChild(applyBtn);
  }, 0);
}

async function loadTPSChart() {
  if (selectedTPSModels.length === 0) {
    selectedTPSModels = tpsModelsList.slice(0, 5);
  }
  
  const modelsParam = selectedTPSModels.join(',');
  const data = await fetchAPI('/stats/daily-tps-by-model?days=30&models=' + modelsParam);
  
  if (charts.tps) charts.tps.destroy();
  
  const ctx = document.getElementById('tpsChart').getContext('2d');
  
  const datasets = data.models.map((model, index) => ({
    label: model.baseModel,
    data: model.data.map(d => d?.tps ?? null),
    borderColor: getColor(index),
    backgroundColor: getColor(index) + '20',
    fill: true,
    tension: 0.3,
    pointRadius: 2,
    pointBackgroundColor: getColor(index),
    pointBorderColor: '#0a0a0a',
    pointBorderWidth: 1,
    pointHoverRadius: 6,
    pointHoverBackgroundColor: getColor(index),
    pointHoverBorderColor: '#00ff88',
    pointHoverBorderWidth: 2,
    borderWidth: 2,
    extraData: model.data
  }));
  
  charts.tps = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.dates,
      datasets: datasets
    },
    options: {
      ...chartDefaults,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        ...chartDefaults.plugins,
        tooltip: {
          ...tooltipDefaults,
          mode: 'index',
          intersect: false,
          callbacks: {
            title: () => '',
            beforeBody: (items) => {
              if (!items.length) return [];
              return [items[0].label];
            },
            label: (ctx) => {
              const extra = ctx.dataset.extraData[ctx.dataIndex];
              const tps = extra?.tps?.toFixed(2) || '-';
              const input = extra?.inputTokens ? formatNumber(extra.inputTokens) : '0';
              const output = extra?.outputTokens ? formatNumber(extra.outputTokens) : '0';
              return [
                ctx.dataset.label,
                `  ├─ TPS: ${tps} tok/s`,
                `  └─ In: ${input} | Out: ${output}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          ...chartDefaults.scales.x,
          ticks: { ...chartDefaults.scales.x.ticks, maxTicksLimit: 10 }
        },
        y: {
          ...chartDefaults.scales.y,
          ticks: {
            ...chartDefaults.scales.y.ticks,
            callback: v => v.toFixed(1) + ' tok/s'
          }
        }
      },
      spanGaps: true
    }
  });
}

function updateModelsTable() {
  const tbody = document.querySelector('#modelsTable tbody');
  tbody.innerHTML = '';
  
  modelsData.forEach(m => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${m.baseModel}</strong></td>
      <td>${formatNumber(m.messageCount)}</td>
      <td>${formatNumber(m.inputTokens)}</td>
      <td>${formatNumber(m.outputTokens)}</td>
      <td>${formatNumber(m.cacheRead)}</td>
      <td>${formatNumber(m.cacheWrite)}</td>
      <td>${formatCurrency(m.cost)}</td>
      <td><span class="badge ${m.isFree ? 'badge-free' : 'badge-paid'}">${m.isFree ? 'FREE' : 'PAID'}</span></td>
    `;
    tbody.appendChild(row);
  });
}

async function loadPricingModal() {
  const models = await fetch(`${API_BASE}/pricing/models`).then(r => r.json());
  const list = document.getElementById('pricingList');
  list.innerHTML = '';
  
  for (const model of models) {
    const prices = model.pricing || { input: 0, output: 0, cacheRead: 0 };
    const inputPerM = (prices.input || 0) * 1000000;
    const outputPerM = (prices.output || 0) * 1000000;
    const cachePerM = (prices.cacheRead || 0) * 1000000;
    
    const item = document.createElement('div');
    item.className = 'pricing-item';
    item.innerHTML = `
      <label>${model.name} <span style="color:#555;font-size:0.7em;">(${formatNumber(model.messageCount)} msgs)</span></label>
      <input type="number" step="0.01" placeholder="Input" value="${inputPerM.toFixed(4)}" data-model="${model.name}" data-field="input">
      <input type="number" step="0.01" placeholder="Output" value="${outputPerM.toFixed(4)}" data-model="${model.name}" data-field="output">
      <input type="number" step="0.01" placeholder="Cache" value="${cachePerM.toFixed(4)}" data-model="${model.name}" data-field="cacheRead">
      <button class="btn btn-sm btn-primary save-btn" data-model="${model.name}">Save</button>
    `;
    list.appendChild(item);
  }
  
  list.querySelectorAll('.save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const model = btn.dataset.model;
      const inputs = list.querySelectorAll(`[data-model="${model}"]`);
      const data = {};
      inputs.forEach(input => {
        if (input.dataset.field) {
          data[input.dataset.field] = parseFloat(input.value) || 0;
        }
      });
      
      btn.textContent = '...';
      await fetch(`${API_BASE}/pricing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, ...data })
      });
      
      btn.textContent = 'Saved';
      setTimeout(() => btn.textContent = 'Save', 1200);
      await loadAll();
    });
  });
}

async function loadAll() {
  await loadOverview();
  await loadModelsChart();
  await loadDailyChart(currentChartType === 'cost');
  await loadHourlyChart();
  await loadWeeklyChart();
  await loadTPSModelsList();
  await loadTPSChart();
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadAll();
    initTPSDropdown();
    document.getElementById('loading').classList.add('hidden');
  } catch (err) {
    console.error('Failed to load:', err);
    document.querySelector('.loading span').textContent = 'Failed to load data. Is the server running?';
  }
  
  document.getElementById('checkAsFree').addEventListener('change', async function() {
    checkAsFree = this.checked;
    await loadAll();
  });
  
  document.getElementById('refreshPricingBtn').addEventListener('click', async function() {
    this.textContent = '...';
    await fetch(`${API_BASE}/pricing/reset`, { method: 'POST' });
    this.textContent = 'Done';
    setTimeout(() => this.textContent = 'Actualize prices', 1500);
    await loadAll();
  });
  
  document.getElementById('editPricingBtn').addEventListener('click', () => {
    loadPricingModal();
    document.getElementById('pricingModal').classList.add('show');
  });
  
  document.querySelector('.close-btn').addEventListener('click', () => {
    document.getElementById('pricingModal').classList.remove('show');
  });
  
  document.getElementById('pricingModal').addEventListener('click', (e) => {
    if (e.target.id === 'pricingModal') {
      e.target.classList.remove('show');
    }
  });
  
  document.querySelectorAll('#mainTimeFilter .btn[data-range]').forEach(btn => {
    btn.addEventListener('click', async function() {
      document.querySelectorAll('#mainTimeFilter .btn[data-range]').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      currentRange = this.dataset.range === 'all' ? 'all' : parseInt(this.dataset.range);
      useCustomRange = false;
      await loadAll();
    });
  });
  
  document.querySelectorAll('.chart-type-toggle .btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      document.querySelectorAll('.chart-type-toggle .btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      if (this.dataset.chart) {
        currentChartType = this.dataset.chart;
        await loadDailyChart(currentChartType === 'cost');
      } else if (this.dataset.hourly) {
        await loadHourlyChart(this.dataset.hourly);
      }
    });
  });
  
  document.getElementById('applyDateRange').addEventListener('click', async function() {
    const start = document.getElementById('startDate').value;
    const end = document.getElementById('endDate').value;
    
    if (start && end) {
      customStart = start;
      customEnd = end;
      useCustomRange = true;
      document.querySelectorAll('#mainTimeFilter .btn[data-range]').forEach(b => b.classList.remove('active'));
      await loadAll();
    }
  });
  
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  document.getElementById('endDate').value = today;
  document.getElementById('startDate').value = thirtyDaysAgo;
});
