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
    trackSearch: document.getElementById('trackSearch'),
    clearSearch: document.getElementById('clearSearch'),
    table: document.getElementById('data-table'),
    tbody: document.querySelector('#data-table tbody'),
    insightsList: document.getElementById('insights-list'),
    scatterDiv: document.getElementById('scatter-plays-likes'),
    artistControls: document.getElementById('artistControls'),
    datasetControls: document.getElementById('dataset-controls'),
    detailsPanel: document.getElementById('detailsPanel'),
  };

  // ---------- State ----------
  let datasets = [];          // array of { name, color, data: { rows, totals, thresholds, avgEngagement, medianPLR }, visible: true }
  let currentRows = [];       // filtered + sorted rows for table and charts
  let sortState = { key: 'plays', dir: 'desc' };
  let scatterChart = null;
  let currentSearchTerm = '';
  let artistData = {};        // Grouped data by artist
  let selectedArtists = [];

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

  function getDatasetColor(index) {
    const colors = [
      '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
      '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
    ];
    return colors[index % colors.length];
  }

  function median(values) {
    const arr = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (arr.length === 0) return null;
    const mid = Math.floor(arr.length / 2);
    if (arr.length % 2 === 0) {
      return (arr[mid - 1] + arr[mid]) / 2;
    }
    return arr[mid];
  }

  // ---------- File Loading ----------
  async function handleSingleCSV(text, filename) {
    try {
      const data = Parser.parseAndProcessCSV(text, getOptions());
      const name = filename.replace('.csv', '').replace(/_/g, ' ');
      const color = getDatasetColor(datasets.length);
      datasets.push({ name, color, data, visible: true });
      updateCombinedData();
      renderAll();
      createDatasetControls();
      els.btnExport.disabled = datasets.length === 0;
    } catch (err) {
      console.error('Parse error:', err);
      alert('Failed to parse CSV. See console for details.');
    }
  }

  function updateCombinedData() {
    // Combine rows from all visible datasets
    currentRows = [];
    artistData = {};
    datasets.forEach(ds => {
      if (ds.visible) {
        ds.data.rows.forEach(row => {
          // Add dataset info to row
          row.datasetName = ds.name;
          row.datasetColor = ds.color;
          currentRows.push(row);
          const artist = row.artist || 'Unknown';
          if (!artistData[artist]) {
            artistData[artist] = [];
          }
          artistData[artist].push(row);
        });
      }
    });
    applySearch();
  }

  function createDatasetControls() {
    if (!els.datasetControls) return;
    els.datasetControls.innerHTML = '';
    datasets.forEach((ds, index) => {
      const container = document.createElement('div');
      container.className = 'dataset-checkbox';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `dataset-${index}`;
      checkbox.checked = ds.visible;
      checkbox.addEventListener('change', () => {
        ds.visible = checkbox.checked;
        updateCombinedData();
        renderAll();
      });

      const colorDiv = document.createElement('div');
      colorDiv.className = 'dataset-color';
      colorDiv.style.backgroundColor = ds.color;

      const label = document.createElement('label');
      label.htmlFor = `dataset-${index}`;
      label.textContent = ds.name;

      container.appendChild(checkbox);
      container.appendChild(colorDiv);
      container.appendChild(label);
      els.datasetControls.appendChild(container);
    });
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
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        alert('Please drop CSV files only.');
        return;
      }
    }
    for (const file of files) {
      const text = await readFile(file);
      await handleSingleCSV(text, file.name);
    }
  }

  async function handleFilePick(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of files) {
      const text = await readFile(file);
      await handleSingleCSV(text, file.name);
    }
    e.target.value = '';
  }

  async function loadSample() {
    // Note: from app/index.html, the CSV is at ../Artists/STATS NEW FORMAT.csv
    const path = '../Artists/STATS NEW FORMAT.csv';
    try {
      const resp = await fetch(path);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      await handleSingleCSV(text, 'STATS NEW FORMAT');
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
    if (datasets.length === 0) {
      els.kpis.totalPlays.textContent = '0';
      els.kpis.avgEng.textContent = '0.00%';
      els.kpis.medianPLR.textContent = '0.00';
      els.kpis.trackCount.textContent = '0';
      return;
    }
    const visibleDatasets = datasets.filter(ds => ds.visible);
    if (visibleDatasets.length === 0) {
      els.kpis.totalPlays.textContent = '0';
      els.kpis.avgEng.textContent = '0.00%';
      els.kpis.medianPLR.textContent = '0.00';
      els.kpis.trackCount.textContent = '0';
      return;
    }
    const totalPlays = visibleDatasets.reduce((sum, ds) => sum + ds.data.totals.plays, 0);
    const totalTracks = visibleDatasets.reduce((sum, ds) => sum + ds.data.rows.length, 0);
    const weightedAvgEng = visibleDatasets.reduce((sum, ds) => sum + ds.data.avgEngagement * ds.data.rows.length, 0) / totalTracks;
    const allPLRs = visibleDatasets.flatMap(ds => ds.data.rows.map(r => r.play_like_ratio).filter(Number.isFinite));
    const medianPLR = median(allPLRs);
    els.kpis.totalPlays.textContent = fmt.int(totalPlays);
    els.kpis.avgEng.textContent = fmt.pct2(weightedAvgEng);
    els.kpis.medianPLR.textContent = medianPLR != null ? fmt.num2(medianPLR) : '';
    els.kpis.trackCount.textContent = String(totalTracks);
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
      // Add subtle background color for dataset
      if (d.datasetColor) {
        tr.style.backgroundColor = d.datasetColor + '20'; // 20 for alpha
      }

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
    const visibleRows = currentRows;
    if (visibleRows.length === 0) return;

    const finitePLRRows = visibleRows.filter(r => Number.isFinite(r.play_like_ratio));
    const topPLR = finitePLRRows.slice().sort((a, b) => a.play_like_ratio - b.play_like_ratio).slice(0, 3);
    const bottomPLR = finitePLRRows.slice().sort((a, b) => b.play_like_ratio - a.play_like_ratio).slice(0, 3);
    const topEng = visibleRows.slice().sort((a, b) => b.engagement_rate_pct - a.engagement_rate_pct).slice(0, 3);

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
    if (!els.scatterDiv) return;
    const rows = currentRows;
    scatterChart = Charts.buildScatter(els.scatterDiv, rows);
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

      // Special handling for category column
      if (key === 'category') {
        const categoryOrder = { 'Excellent': 1, 'Good': 2, 'Average': 3, 'Poor': 4 };
        const orderA = categoryOrder[va] || 5;
        const orderB = categoryOrder[vb] || 5;
        return sign * (orderA - orderB);
      }

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
    if (datasets.length === 0) {
      currentRows = [];
      return;
    }
    const allRows = datasets.filter(ds => ds.visible).flatMap(ds => ds.data.rows.map(r => ({ ...r, datasetName: ds.name, datasetColor: ds.color })));
    if (!q) {
      currentRows = allRows.slice();
    } else {
      currentRows = allRows.filter(r => (r.title || '').toLowerCase().includes(q));
    }
    applySort();
  }

  // ---------- Export ----------
  function doExport() {
    if (datasets.length === 0) return;
    const visibleDatasets = datasets.filter(ds => ds.visible);
    if (visibleDatasets.length === 0) return;
    // Combine data for export
    const combinedRows = visibleDatasets.flatMap(ds => ds.data.rows);
    const combinedTotals = combinedRows.reduce((acc, d) => {
      acc.plays += d.plays;
      acc.likes += d.likes;
      acc.reposts += d.reposts;
      acc.comments += d.comments;
      return acc;
    }, { plays: 0, likes: 0, reposts: 0, comments: 0 });
    const combinedData = {
      rows: combinedRows,
      totals: combinedTotals,
      thresholds: {}, // Not used in export
      avgEngagement: 0, // Not calculated
      medianPLR: 0
    };
    const csv = Parser.toCSV(combinedData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'soundcloud_analytics_combined.csv';
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

    // Options change re-process all datasets
    [els.optMissingAsZero, els.optShowQuality, els.categoryMode].forEach(ctrl => {
      ctrl?.addEventListener('change', async () => {
        if (datasets.length > 0) {
          // Re-process all datasets with new options
          for (let i = 0; i < datasets.length; i++) {
            const ds = datasets[i];
            // We need the original text, but we don't have it. For now, alert to re-upload.
            alert('Option changed. Please re-upload the CSVs to re-process with new settings.');
            break;
          }
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

    // Track search for charts
    if (els.trackSearch) {
      els.trackSearch.addEventListener('input', (e) => {
        currentSearchTerm = e.target.value.toLowerCase();
        renderCharts();
      });
    }

    if (els.clearSearch) {
      els.clearSearch.addEventListener('click', () => {
        if (els.trackSearch) {
          els.trackSearch.value = '';
          currentSearchTerm = '';
          renderCharts();
        }
      });
    }

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
    function buildScatter(div, rows) {
      if (!rows || rows.length === 0) {
        Plotly.newPlot(div, [], {});
        return null;
      }

      // Group data by dataset
      const datasetNames = [...new Set(rows.map(r => r.datasetName))];

      // Filter data based on search
      const filteredRows = rows.filter(row => {
        const matchesSearch = !currentSearchTerm ||
          (row.title || '').toLowerCase().includes(currentSearchTerm.toLowerCase());
        return matchesSearch;
      });

      // Calculate min/max values for scaling
      const playsValues = filteredRows.map(r => r.plays).filter(Number.isFinite);
      const likePctValues = filteredRows.map(r => r.like_pct).filter(Number.isFinite);

      const minPlays = Math.min(...playsValues);
      const maxPlays = Math.max(...playsValues);
      const minLikePct = Math.min(...likePctValues);
      const maxLikePct = Math.max(...likePctValues);

      // Create traces for each dataset
      const traces = datasetNames.map((dsName, index) => {
        const dsRows = filteredRows.filter(r => r.datasetName === dsName);
        const ds = datasets.find(d => d.name === dsName);

        return {
          x: dsRows.map(r => r.plays),
          y: dsRows.map(r => r.like_pct),
          mode: 'markers',
          type: 'scatter',
          name: dsName,
          marker: {
            size: dsRows.map(r => Math.max(8, Math.min(25, Math.log(r.plays + 1) * 2))),
            color: ds ? ds.color : '#888',
            line: { width: 1, color: 'rgba(255,255,255,0.8)' }
          },
          customdata: dsRows.map(r => ({
            title: r.title,
            plays: r.plays,
            likes: r.likes,
            likePct: r.like_pct,
            artist: r.artist || 'Unknown',
            dataset: dsName
          })),
          hovertemplate:
            `<b>${dsName}</b><br>` +
            `<b>%{customdata.title}</b><br>` +
            `Plays: %{x:,.0f}<br>` +
            `Likes: %{customdata.likes:,.0f}<br>` +
            `Like %: %{y:.2f}%<br>` +
            `<extra></extra>`
        };
      });

      const layout = {
        title: {
          text: 'SoundCloud: Plays vs Like Percentage',
          font: { size: 16, weight: 600 }
        },
        xaxis: {
          title: { text: 'Plays', font: { size: 14 } },
          type: 'log',
          autorange: true,
          gridcolor: 'rgba(0,0,0,0.1)',
          showgrid: true
        },
        yaxis: {
          title: { text: 'Like %', font: { size: 14 } },
          type: 'linear',
          range: [0, Math.max(100, maxLikePct * 1.1)],
          gridcolor: 'rgba(0,0,0,0.1)',
          showgrid: true
        },
        margin: { t: 50, b: 80, l: 60, r: 20 },
        showlegend: true,
        hovermode: 'closest',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)'
      };

      const config = {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d']
      };

      Plotly.newPlot(div, traces, layout, config);

      // Add click handler
      div.on('plotly_click', function(data) {
        if (data.points.length > 0) {
          const point = data.points[0];
          const trackData = point.data.customdata[point.pointIndex];
          showTrackDetails(trackData);
        }
      });

      return traces;
    }

    return { buildScatter };
  })();

  // ---------- Track Details ----------
  function showTrackDetails(track) {
    if (!els.detailsPanel) return;

    const panel = els.detailsPanel;
    const titleEl = panel.querySelector('#track-title');
    const playsEl = panel.querySelector('#plays');
    const likesEl = panel.querySelector('#likes');
    const ratioEl = panel.querySelector('#ratio');
    const playButton = panel.querySelector('#playButton');

    if (titleEl) titleEl.textContent = track.title || 'Unknown Track';
    if (playsEl) playsEl.textContent = fmt.int(track.plays);
    if (likesEl) likesEl.textContent = fmt.int(track.likes);
    if (ratioEl) ratioEl.textContent = fmt.num2(track.likePct) + '%';

    // Show panel with animation
    panel.style.display = 'block';
    panel.style.animation = 'slideUp 0.3s ease';

    // Add close button handler
    const closeButton = panel.querySelector('.close-button');
    if (closeButton) {
      closeButton.onclick = () => {
        panel.style.display = 'none';
      };
    }
  }

  // ---------- Init ----------
  function init() {
    wireEvents();
    // Activate default tab states
    switchTab('table');
  }

  document.addEventListener('DOMContentLoaded', init);
})();