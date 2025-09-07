# SoundCloud Analyser 2025

A client-side, dark-themed analytics dashboard to process SoundCloud artist track CSVs and generate engagement insights. No backend; all parsing and computation happen in the browser.

Key capabilities:
- Robust CSV parsing with duplicate header removal, empty row skipping, numbers with commas, k/K notation (including decimals), and missing/coerced values.
- Relative date parsing (e.g., "8 days ago", "6 months ago", "1 year ago", "2 weeks ago") to ISO date and days since upload.
- Metrics: Play/Like Ratio, Engagement Rate %, Like %, Days since upload, Plays per day.
- Quantile-based categorization by Play/Like Ratio (quartiles).
- Interactive table (sort, search) with heat backgrounds for key metrics and color-coded categories.
- Scatter chart (Plays vs Likes) with trend line.
- Insights summary and CSV export of computed analytics.

## Project structure
- [index.html](app/index.html)
- [styles.css](app/styles.css)
- [app.js](app/app.js)
- [parser.js](app/parser.js)
- [charts.js](app/charts.js)
- [Artists sample CSV](Artists/STATS NEW FORMAT.csv)

## Running locally

Option A: Open the HTML file directly
- Open [index.html](app/index.html).
- Note: Browsers often block fetches of local sibling files when opened via file://. The "Load sample" button may fail in this mode; use drag-and-drop to load your CSV instead.

Option B: Run a local static server (recommended)
- Any static server works. Examples:
  - VS Code Live Server extension: open the repository and "Open with Live Server", then visit /app/index.html.
  - Python 3: run `python -m http.server 5500` from the repo root, then open http://localhost:5500/app/index.html.
- In this mode, "Load sample" will fetch [STATS NEW FORMAT.csv](Artists/STATS NEW FORMAT.csv) and parse it automatically.

## Using the app
1. Load data:
   - Drag and drop your CSV into the dropzone, or
   - Click "Load sample" to use the included sample CSV.
2. Review KPIs for quick orientation.
3. Use the Table:
   - Column sorting (click headers).
   - Search tracks by title.
   - Category chips and metric heat backgrounds highlight performance.
4. Charts:
   - Scatter: Plays vs Likes with trend line, color-coded by category.
5. Insights:
   - Top/bottom performers (initial pass).
6. Export:
   - "Export CSV" downloads a computed analytics CSV including derived metrics.

## CSV format expectations

Canonical header fields (order): TRACK, POSTED, LIKES, REPOSTS, PLAYS, COMMENTS

The parser is resilient to:
- Duplicate header rows anywhere in the file (they are removed).
- Fully empty rows (skipped).
- Numbers with thousands separators inside quotes (e.g., "2,475").
- k/K notation including decimals (e.g., 14.2K → 14200, 52.5K → 52500).
- Missing or corrupt numeric fields (coerced to 0; flagged in data quality).
- Non-numeric tokens in numeric columns (e.g., "Repost") are coerced to 0; flagged.
- Relative "posted" dates: days/weeks/months/years ago (singular/plural), converted to ISO date and days since upload.

## Data model (summary)

For each track:
- title: from TRACK (trimmed).
- posted_iso: derived ISO date from POSTED; null if unparsable.
- days_since_upload: integer; null if POSTED unparsable.
- likes, reposts, plays, comments: integers (k/K and commas handled).
- play_like_ratio: plays / likes; Infinity if likes == 0 and plays > 0; null if plays == 0.
- engagement_rate_pct: (likes + reposts + comments) / plays * 100; 0 if plays == 0.
- like_pct: likes / plays * 100; 0 if plays == 0.
- plays_per_day: plays / max(days_since_upload, 1).
- category: by quantiles on finite play_like_ratio (Q1=Excellent, Q2=Good, Q3=Average, >Q3=Poor); rows with likes==0 are forced to Poor.
- quality.invalid_fields: array of field names coerced or flagged (e.g., ["reposts"] for a non-numeric token).

Aggregates:
- totals: plays, likes, reposts, comments (sums).
- avgEngagement: mean engagement rate % across tracks.
- medianPLR: median of finite play_like_ratio values.
- thresholds: Q1/Q2/Q3 breakpoints used for categorization.

## Metrics definitions

- Play/Like Ratio (PLR): plays / likes
  - Lower is better (fewer plays per like).
  - If likes == 0 and plays > 0, PLR is Infinity; categorized as Poor.
- Engagement Rate %: (likes + reposts + comments) / plays * 100
- Like %: likes / plays * 100
- Plays per day: plays / days_since_upload

## Accessibility and theme

- Dark palette:
  - Background: #121417
  - Surface: #1a1f24
  - Primary: #7bd88f
  - Accent: #5cc8ff
  - Danger: #ff6b6b
  - Warning: #f3c969
- Visible focus outlines, keyboard navigable controls, and high-contrast text/colors target WCAG AA. Further accessibility enhancements are planned.

## Troubleshooting

- Sample not loading:
  - If opened via file://, browsers block cross-folder fetches. Run a local server (see above) or drag-and-drop the CSV into the dropzone.
- Parsing error alert:
  - Check console for details. Validate that headers match the canonical names and there are no unexpected binary characters.
- Categories look odd:
  - Quartiles are computed only on finite PLR entries. Many tracks with zero likes will be forced to Poor (by design).

## Roadmap

- Persist user preferences (localStorage).
- Additional charts: category distribution, top-N by PLR, engagement comparisons.
- Performance: virtualization/pagination for large datasets, rendering throttles.
- CSV import options: toggle missing-as-zero at parse time.
- Full accessibility pass and comprehensive QA coverage.