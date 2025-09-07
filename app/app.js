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
    detailsPanel: document.getElementById('detailsPanel'),
  };

  // ---------- State ----------
  let dataset = null;         // full processed dataset { rows, totals, thresholds, avgEngagement, medianPLR }
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

  // ---------- File Loading ----------
  async function handleCSVText(text) {
    try {
      dataset = Parser.parseAndProcessCSV(text, getOptions());
      currentRows = dataset.rows.slice();

      // Group data by artist for chart functionality
      artistData = {};
      currentRows.forEach(row => {
        const artist = row.artist || 'Unknown';
        if (!artistData[artist]) {
          artistData[artist] = [];
        }
        artistData[artist].push(row);
      });

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

      // Group data by artist if available
      const artists = [...new Set(rows.map(r => r.artist || 'Unknown'))];
      selectedArtists = artists;

      // Create artist controls
      createArtistControls(artists);

      // Filter data based on selected artists and search
      const filteredRows = rows.filter(row => {
        const matchesArtist = selectedArtists.includes(row.artist || 'Unknown');
        const matchesSearch = !currentSearchTerm ||
          (row.title || '').toLowerCase().includes(currentSearchTerm.toLowerCase());
        return matchesArtist && matchesSearch;
      });

      // Calculate min/max values for scaling
      const playsValues = filteredRows.map(r => r.plays).filter(Number.isFinite);
      const ratioValues = filteredRows.map(r => r.play_like_ratio).filter(Number.isFinite);

      const minPlays = Math.min(...playsValues);
      const maxPlays = Math.max(...playsValues);
      const minRatio = Math.min(...ratioValues);
      const maxRatio = Math.max(...ratioValues);

      // Generate distinct colors for artists
      const getArtistColor = (index) => {
        const colors = [
          '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
          '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
        ];
        return colors[index % colors.length];
      };

      // Create traces for each artist
      const traces = artists.map((artist, index) => {
        const artistRows = filteredRows.filter(r => (r.artist || 'Unknown') === artist);

        return {
          x: artistRows.map(r => r.plays),
          y: artistRows.map(r => r.play_like_ratio),
          mode: 'markers',
          type: 'scatter',
          name: artist,
          marker: {
            size: artistRows.map(r => Math.max(8, Math.min(25, Math.log(r.plays + 1) * 2))),
            color: getArtistColor(index),
            line: { width: 1, color: 'rgba(255,255,255,0.8)' }
          },
          customdata: artistRows.map(r => ({
            title: r.title,
            plays: r.plays,
            likes: r.likes,
            ratio: r.play_like_ratio,
            artist: artist
          })),
          hovertemplate:
            `<b>${artist}</b><br>` +
            `<b>%{customdata.title}</b><br>` +
            `Plays: %{x:,.0f}<br>` +
            `Likes: %{customdata.likes:,.0f}<br>` +
            `Ratio: %{y:.2f}%<br>` +
            `<extra></extra>`
        };
      });

      const layout = {
        title: {
          text: 'SoundCloud: Plays vs Play/Like Ratio',
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
          title: { text: 'Play/Like Ratio (%)', font: { size: 14 } },
          type: 'linear',
          autorange: true,
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

    function createArtistControls(artists) {
      if (!els.artistControls) return;

      els.artistControls.innerHTML = '<h4>Artists</h4>';
      els.artistControls.style.display = artists.length > 1 ? 'block' : 'none';

      artists.forEach(artist => {
        const container = document.createElement('div');
        container.className = 'artist-checkbox';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `artist-${artist}`;
        checkbox.checked = selectedArtists.includes(artist);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            selectedArtists.push(artist);
          } else {
            selectedArtists = selectedArtists.filter(a => a !== artist);
          }
          renderCharts();
        });

        const label = document.createElement('label');
        label.htmlFor = `artist-${artist}`;
        label.textContent = artist;

        container.appendChild(checkbox);
        container.appendChild(label);
        els.artistControls.appendChild(container);
      });
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
    if (ratioEl) ratioEl.textContent = fmt.num2(track.ratio) + '%';

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