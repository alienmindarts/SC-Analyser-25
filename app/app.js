/* SoundCloud Analyser - App bootstrap and UI wiring
   Features in this slice:
   - CSV upload (file picker + drag/drop) and sample loader
   - Robust parsing via Parser.parseAndProcessCSV (see parser.js)
   - KPIs (totals, average engagement, median PLR, track count)
   - Interactive table: sorting + search filter
   - Scatter chart: Plays vs Likes with trend line and category coloring
   - Export computed analytics as CSV
*/

(function () {
  'use strict';

  // ---------- DOM ----------
  const els = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    btnLoadSample: document.getElementById('load-sample'),
    btnExport: document.getElementById('export-csv'),
    optMissingAsZero: document.getElementById('opt-missing-as-zero'),
    optShowQuality: document.getElementById('opt-show-quality'),
    categoryMode: document.getElementById('category-mode'),
    kpis: {
      totalPlays: document.getElementById('kpi-total-plays'),
      avgEng: document.getElementById('kpi-avg-engagement'),
      medianPLR: document.getElementById('kpi-median-plr'),
      trackCount: document.getElementById('kpi-track-count'),
    },
    tabs: document.querySelectorAll('.tab'),
    tabpanels: document.querySelectorAll('.tabpanel'),
    search: document.getElementById('search'),
    table: document.getElementById('data-table'),
    tbody: document.querySelector('#data-table tbody'),
    insightsList: document.getElementById('insights-list'),
    scatterCanvas: document.getElementById('scatter-plays-likes'),
  };

  // ---------- State ----------
  let dataset = null;         // full processed dataset { rows, totals, thresholds, avgEngagement, medianPLR }
  let currentRows = [];       // filtered + sorted rows for table and charts
  let sortState = { key: 'plays', dir: 'desc' };
  let scatterChart = null;

  // ---------- Utils ----------
  const fmt = {
    int(n) {
      if (n === null || n === undefined || !Number.isFinite(n)) return '';
      return n.toLocaleString();
    },
    num2(n, suffix = '') {
      if (n === null || n === undefined || !Number.isFinite(n)) return '';
      return (Math.round(n * 100) / 100).toFixed(2) + suffix;
    },
    pct2(n) {
      if (n === null || n === undefined || !Number.isFinite(n)) return '';
      return (Math.round(n * 100) / 100).toFixed(2) + '%';
    },
    date(s) {
      return s || '';
    },
    categoryChip(cat) {
      const cls = catClass(cat);
      return '<span class="chip ' + cls + '">' + cat + '</span>';
    }
  };

  function catClass(cat) {
    switch ((cat || '').toLowerCase()) {
      case 'excellent': return 'cat-excellent';
      case 'good': return 'cat-good';
      case 'average': return 'cat-average';
      default: return 'cat-poor';
    }
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function getOptions() {
    return {
      missingAsZero: !!els.optMissingAsZero?.checked,
      showQuality: !!els.optShowQuality?.checked,
      categoryMode: els.categoryMode?.value || 'quantile',
    };
  }

  // ---------- File Loading ----------
  async function handleCSVText(text) {
    try {
      dataset = Parser.parseAndProcessCSV(text, getOptions());
      currentRows = dataset.rows.slice();
      applySearch();
      renderAll();
      els.btnExport.disabled = !dataset || dataset.rows.length === 0;
    } catch (err) {
      console.error('Parse error:', err);
      alert('Failed to parse CSV. See console for details.');
    }
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsText(file);
    });
  }

  async function handleDrop(e) {
    e.preventDefault();
    els.dropzone.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please drop a CSV file.');
      return;
    }
    const text = await readFile(file);
    await handleCSVText(text);
  }

  async function handleFilePick(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const text = await readFile(file);
    await handleCSVText(text);
    e.target.value = '';
  }

  async function loadSample() {
    // Note: from app/index.html, the CSV is at ../Artists/STATS NEW FORMAT.csv
    const path = '../Artists/STATS NEW FORMAT.csv';
    try {
      const resp = await fetch(path);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      await handleCSVText(text);
    } catch (err) {
      console.warn('Sample fetch failed. Likely due to browser blocking file:// fetch. Use a local server or drag-drop the CSV.', err);
      alert('Could not load sample automatically. If you opened index.html directly from the file system, the browser may block local fetches. Drag and drop the CSV into the dropzone or run a local server.');
    }
  }

  // ---------- Rendering ----------
  function renderAll() {
    renderKPIs();
    renderTable();
    renderInsights();
    renderCharts();
  }

  function renderKPIs() {
    if (!dataset) {
      els.kpis.totalPlays.textContent = '0';
      els.kpis.avgEng.textContent = '0.00%';
      els.kpis.medianPLR.textContent = '0.00';
      els.kpis.trackCount.textContent = '0';
      return;
    }
    els.kpis.totalPlays.textContent = fmt.int(dataset.totals.plays);
    els.kpis.avgEng.textContent = fmt.pct2(dataset.avgEngagement);
    els.kpis.medianPLR.textContent = dataset.medianPLR != null ? fmt.num2(dataset.medianPLR) : '';
    els.kpis.trackCount.textContent = String(dataset.rows.length);
  }

  function renderTable() {
    const rows = currentRows;
    const tbody = els.tbody;
    tbody.innerHTML = '';

    // infer scales for heat backgrounds
    const maxPLR = Math.max(1, ...rows.map(r => Number.isFinite(r.play_like_ratio) ? r.play_like_ratio : 0));
    const maxEng = Math.max(1, ...rows.map(r => r.engagement_rate_pct || 0));
    const maxPPD = Math.max(1, ...rows.map(r => r.plays_per_day || 0));

    const frag = document.createDocumentFragment();
    for (const d of rows) {
      const tr = document.createElement('tr');

      const cells = [
        { key: 'title', val: d.title },
        { key: 'posted_iso', val: fmt.date(d.posted_iso) },
        { key: 'days_since_upload', val: d.days_since_upload ?? '' },
        { key: 'plays', val: fmt.int(d.plays) },
        { key: 'likes', val: fmt.int(d.likes) },
        { key: 'reposts', val: fmt.int(d.reposts) },
        { key: 'comments', val: fmt.int(d.comments) },
        { key: 'play_like_ratio', val: Number.isFinite(d.play_like_ratio) ? fmt.num2(d.play_like_ratio) : '∞' },
        { key: 'engagement_rate_pct', val: fmt.pct2(d.engagement_rate_pct) },
        { key: 'like_pct', val: fmt.pct2(d.like_pct) },
        { key: 'plays_per_day', val: fmt.num2(d.plays_per_day) },
        { key: 'category', val: fmt.categoryChip(d.category), html: true },
      ];

      for (const c of cells) {
        const td = document.createElement('td');
        td.setAttribute('data-key', c.key);
        if (c.html) {
          td.innerHTML = c.val;
        } else {
          td.textContent = c.val;
        }

        // heat backgrounds for selected metrics
        if (c.key === 'play_like_ratio' && Number.isFinite(d.play_like_ratio)) {
          const pct = Math.max(0.05, Math.min(1, d.play_like_ratio / maxPLR));
          td.style.background = `linear-gradient(90deg, rgba(123,216,143,0.15) ${pct * 100}%, transparent ${pct * 100}%)`;
        } else if (c.key === 'engagement_rate_pct' && Number.isFinite(d.engagement_rate_pct)) {
          const pct = Math.max(0.05, Math.min(1, d.engagement_rate_pct / maxEng));
          td.style.background = `linear-gradient(90deg, rgba(92,200,255,0.18) ${pct * 100}%, transparent ${pct * 100}%)`;
        } else if (c.key === 'plays_per_day' && Number.isFinite(d.plays_per_day)) {
          const pct = Math.max(0.05, Math.min(1, d.plays_per_day / maxPPD));
          td.style.background = `linear-gradient(90deg, rgba(243,201,105,0.18) ${pct * 100}%, transparent ${pct * 100}%)`;
        }

        tr.appendChild(td);
      }

      frag.appendChild(tr);
    }

    tbody.appendChild(frag);
    wireSortingHeaders();
  }

  function renderInsights() {
    const el = els.insightsList;
    el.innerHTML = '';
    if (!dataset || dataset.rows.length === 0) return;

    const finitePLRRows = dataset.rows.filter(r => Number.isFinite(r.play_like_ratio));
    const topPLR = finitePLRRows.slice().sort((a, b) => a.play_like_ratio - b.play_like_ratio).slice(0, 3);
    const bottomPLR = finitePLRRows.slice().sort((a, b) => b.play_like_ratio - a.play_like_ratio).slice(0, 3);
    const topEng = dataset.rows.slice().sort((a, b) => b.engagement_rate_pct - a.engagement_rate_pct).slice(0, 3);

    const items = [];
    if (topPLR.length) items.push(`Top Play/Like: ${topPLR.map(r => r.title).join(' • ')}`);
    if (bottomPLR.length) items.push(`Bottom Play/Like: ${bottomPLR.map(r => r.title).join(' • ')}`);
    if (topEng.length) items.push(`Top Engagement %: ${topEng.map(r => r.title).join(' • ')}`);

    for (const txt of items) {
      const li = document.createElement('li');
      li.textContent = txt;
      el.appendChild(li);
    }
  }

  function renderCharts() {
    if (!els.scatterCanvas) return;
    if (scatterChart) {
      scatterChart.destroy();
      scatterChart = null;
    }
    const rows = currentRows;
    scatterChart = Charts.buildScatter(els.scatterCanvas, rows);
  }

  // ---------- Sorting & Search ----------
  function wireSortingHeaders() {
    const ths = els.table.querySelectorAll('thead th.sortable');
    ths.forEach(th => {
      th.onclick = () => {
        const key = th.getAttribute('data-key');
        if (!key) return;
        if (sortState.key === key) {
          sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
          sortState.key = key;
          sortState.dir = 'desc';
        }
        applySort();
        renderTable();
      };
    });
  }

  function applySort() {
    const { key, dir } = sortState;
    const sign = dir === 'asc' ? 1 : -1;
    currentRows.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      // Handle strings vs numbers
      if (typeof va === 'string' || typeof vb === 'string') {
        return sign * String(va || '').localeCompare(String(vb || ''));
      }
      const na = Number(va);
      const nb = Number(vb);
      if (!Number.isFinite(na) && !Number.isFinite(nb)) return 0;
      if (!Number.isFinite(na)) return 1;
      if (!Number.isFinite(nb)) return -1;
      return sign * (na - nb);
    });
  }

  const doSearch = debounce(() => {
    applySearch();
    renderTable();
    renderCharts();
  }, 150);

  function applySearch() {
    const q = (els.search?.value || '').trim().toLowerCase();
    if (!dataset) {
      currentRows = [];
      return;
    }
    if (!q) {
      currentRows = dataset.rows.slice();
    } else {
      currentRows = dataset.rows.filter(r => (r.title || '').toLowerCase().includes(q));
    }
    applySort();
  }

  // ---------- Export ----------
  function doExport() {
    if (!dataset) return;
    const csv = Parser.toCSV(dataset);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'soundcloud_analytics.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- Tabs ----------
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(btn => {
      const isActive = btn.getAttribute('data-tab') === name;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('.tabpanel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${name}`);
    });
  }

  // ---------- Events ----------
  function wireEvents() {
    // Dropzone
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.dropzone.classList.add('dragover');
    });
    els.dropzone.addEventListener('dragleave', () => {
      els.dropzone.classList.remove('dragover');
    });
    els.dropzone.addEventListener('drop', handleDrop);

    // File picker
    els.fileInput.addEventListener('change', handleFilePick);

    // Sample
    els.btnLoadSample.addEventListener('click', loadSample);

    // Export
    els.btnExport.addEventListener('click', doExport);

    // Options change re-process if we have raw? We only have processed data; for now re-parse requires re-load.
    // To keep simple, we just inform user to re-load CSV after toggling options.
    [els.optMissingAsZero, els.optShowQuality, els.categoryMode].forEach(ctrl => {
      ctrl?.addEventListener('change', () => {
        if (dataset) {
          alert('Option changed. Please re-load the CSV (Load sample or upload again) to re-process with new settings.');
        }
      });
    });

    // Tabs
    els.tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-tab');
        switchTab(name);
        if (name === 'charts') {
          // ensure chart is sized when visible
          renderCharts();
        }
      });
    });

    // Search
    els.search.addEventListener('input', doSearch);

    // Window resize for charts
    const debouncedResize = debounce(() => {
      if (document.querySelector('#tab-charts').classList.contains('active')) {
        renderCharts();
      }
    }, 150);
    window.addEventListener('resize', debouncedResize);
  }

  // ---------- Charts module wrapper ----------
  const Charts = (function () {
    function buildScatter(canvas, rows) {
      const cats = ['Excellent', 'Good', 'Average', 'Poor'];
      const catColor = {
        Excellent: 'rgba(123,216,143,0.95)',
        Good: 'rgba(109,211,193,0.95)',
        Average: 'rgba(232,198,255,0.95)',
        Poor: 'rgba(255,179,193,0.95)',
      };
      const datasets = cats.map(cat => ({
        label: cat,
        data: rows
          .filter(r => r.category === cat && Number.isFinite(r.plays) && Number.isFinite(r.like_pct))
          .map(r => ({ x: r.plays, y: r.like_pct, title: r.title })),
        backgroundColor: catColor[cat],
        pointRadius: 4,
        pointHoverRadius: 6,
      }));

      // Regression (least squares) on all points with finite plays and like %
      const pts = rows
        .filter(r => Number.isFinite(r.plays) && Number.isFinite(r.like_pct))
        .map(r => ({ x: r.plays, y: r.like_pct }));
      const trend = regressionLine(pts);
      if (trend) {
        const [minX, maxX] = minMaxX(pts);
        const y1 = trend.a * minX + trend.b;
        const y2 = trend.a * maxX + trend.b;
        datasets.push({
          label: 'Trend',
          data: [{ x: minX, y: y1 }, { x: maxX, y: y2 }],
          type: 'line',
          borderColor: 'rgba(92,200,255,0.9)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        });
      }

      const chart = new Chart(canvas, {
        type: 'scatter',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#e6edf3' } },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const p = ctx.raw;
                  const title = p.title ? ` ${p.title}` : '';
                  return `${ctx.dataset.label}${title}: (${fmt.int(p.x)}, ${fmt.pct2(p.y)})`;
                }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Plays', color: '#9aa7b2' },
              ticks: { color: '#9aa7b2' },
              grid: { color: 'rgba(154,167,178,0.12)' }
            },
            y: {
              title: { display: true, text: 'Like %', color: '#9aa7b2' },
              ticks: { color: '#9aa7b2', callback: (v) => v + '%' },
              grid: { color: 'rgba(154,167,178,0.12)' }
            }
          }
        }
      });
      return chart;
    }

    function regressionLine(points) {
      if (!points || points.length < 2) return null;
      let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
      for (const p of points) {
        sumX += p.x; sumY += p.y;
        sumXY += p.x * p.y;
        sumXX += p.x * p.x;
      }
      const n = points.length;
      const denom = (n * sumXX - sumX * sumX);
      if (denom === 0) return null;
      const a = (n * sumXY - sumX * sumY) / denom; // slope
      const b = (sumY - a * sumX) / n;             // intercept
      return { a, b };
    }

    function minMaxX(points) {
      let min = Infinity, max = -Infinity;
      for (const p of points) {
        if (p.x < min) min = p.x;
        if (p.x > max) max = p.x;
      }
      return [min, max];
    }

    return { buildScatter };
  })();

  // ---------- Init ----------
  function init() {
    wireEvents();
    // Activate default tab states
    switchTab('table');
  }

  document.addEventListener('DOMContentLoaded', init);
})();