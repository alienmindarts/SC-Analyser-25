/* SoundCloud Analyser - Parser and Metrics
   Handles:
   - Robust CSV parsing (quotes, commas)
   - Duplicate header removal and empty row skipping
   - Number parsing with commas and k/K suffix (decimals supported)
   - Relative date parsing to ISO and days since upload
   - Data normalization and metrics computation
   - Quantile-based categorization (quartiles of play/like ratio)
*/

(function () {
  'use strict';

  const CANONICAL_HEADERS = ["track", "posted", "likes", "reposts", "plays", "comments"];

  function isHeaderRow(fields) {
    if (!fields || fields.length < 6) return false;
    const lower = fields.slice(0, 6).map(v => String(v || "").trim().toLowerCase());
    for (let i = 0; i < CANONICAL_HEADERS.length; i++) {
      if (lower[i] !== CANONICAL_HEADERS[i]) return false;
    }
    return true;
  }

  function allEmpty(fields) {
    if (!fields) return true;
    return fields.every(v => String(v || "").trim() === "");
  }

  // CSV parser supporting quoted fields with commas and escaped quotes ("")
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];

      if (inQuotes) {
        if (c === '"') {
          // Check escape
          if (i + 1 < text.length && text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ",") {
          row.push(field);
          field = "";
        } else if (c === "\r") {
          // ignore, handle at \n
        } else if (c === "\n") {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        } else {
          field += c;
        }
      }
    }
    // push last field
    row.push(field);
    rows.push(row);

    // Trim possible trailing empty line produced by file ending with newline
    if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
      rows.pop();
    }

    return rows;
  }

  // Parse numeric strings with support for:
  // - quoted numbers with commas "2,475"
  // - k or K suffix (with decimals): 14.2K => 14200
  // - empty strings and invalid tokens
  function parseNumber(value, missingAsZero = true, quality, fieldName) {
    const q = quality || { invalid_fields: [] };
    if (value === null || value === undefined) {
      if (!missingAsZero) return null;
      q.invalid_fields.push(fieldName);
      return 0;
    }
    let v = String(value).trim();
    if (v === "") {
      if (!missingAsZero) return null;
      q.invalid_fields.push(fieldName);
      return 0;
    }
    // handle non-numeric tokens like "Repost"
    const token = v.toLowerCase();
    // Remove commas
    v = v.replace(/,/g, "");
    // Handle K suffix
    const kMatch = v.match(/^(-?\d+(\.\d+)?)\s*[kK]$/);
    if (kMatch) {
      const num = parseFloat(kMatch[1]);
      if (isFinite(num)) {
        return Math.round(num * 1000);
      }
      if (!missingAsZero) return null;
      q.invalid_fields.push(fieldName);
      return 0;
    }
    // Regular number
    const num = Number(v);
    if (Number.isFinite(num)) {
      return Math.round(num);
    }
    // Fallback for tokens
    if (!missingAsZero) return null;
    q.invalid_fields.push(fieldName);
    return 0;
  }

  // Parse relative date strings like "8 days ago", "6 months ago", "1 year ago", "2 weeks ago"
  // Returns { iso: string|null, days: number|null }
  function parseRelativeDate(s) {
    if (!s) return { iso: null, days: null };
    const str = String(s).trim().toLowerCase();
    const re = /^(\d+)\s+(day|days|week|weeks|month|months|year|years)\s+ago$/i;
    const m = str.match(re);
    if (!m) {
      return { iso: null, days: null };
    }
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const now = new Date();

    let days = 0;
    if (unit.startsWith("day")) {
      days = n;
    } else if (unit.startsWith("week")) {
      days = n * 7;
    } else if (unit.startsWith("month")) {
      // Approximate months as 30 days
      days = n * 30;
    } else if (unit.startsWith("year")) {
      // Approximate years as 365 days
      days = n * 365;
    }

    const then = new Date(now);
    then.setDate(now.getDate() - days);

    // Normalize to YYYY-MM-DD
    const iso = new Date(Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())).toISOString().slice(0, 10);
    return { iso, days };
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

  function quantiles(values) {
    const arr = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (arr.length === 0) return { Q1: null, Q2: null, Q3: null };
    const q = (p) => {
      const idx = (arr.length - 1) * p;
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      if (lo === hi) return arr[lo];
      return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
    };
    return { Q1: q(0.25), Q2: q(0.5), Q3: q(0.75) };
  }

  function computeCategory(plr, likes, thresholds) {
    if (!Number.isFinite(plr)) return "Poor";
    if (likes === 0) return "Poor";
    const { Q1, Q2, Q3 } = thresholds;
    if (Q1 === null) return "Average";
    if (plr <= Q1) return "Excellent";
    if (plr <= Q2) return "Good";
    if (plr <= Q3) return "Average";
    return "Poor";
  }

  function sanitizeRow(arr) {
    const row = new Array(6);
    for (let i = 0; i < 6; i++) row[i] = (arr[i] !== undefined) ? String(arr[i]) : "";
    return row;
  }

  // Convert parsed CSV rows into normalized objects and compute metrics
  function processDataRows(rows, opts) {
    const options = Object.assign({
      missingAsZero: true,
      showQuality: true,
      categoryMode: "quantile",
    }, opts || {});
    const data = [];
    let lineNo = 0;

    for (const r of rows) {
      lineNo++;
      const row = sanitizeRow(r);

      if (isHeaderRow(row)) continue; // drop duplicate headers
      if (allEmpty(row)) continue;

      const [track_raw, posted_raw, likes_raw, reposts_raw, plays_raw, comments_raw] = row;
      const quality = { invalid_fields: [] };

      const title = String(track_raw || "").trim();
      if (!title) {
        // skip rows with no track name
        continue;
      }

      const { iso: posted_iso, days: days_since_upload } = parseRelativeDate(posted_raw);

      const likes = parseNumber(likes_raw, options.missingAsZero, quality, "likes");
      const reposts = parseNumber(reposts_raw, options.missingAsZero, quality, "reposts");
      const plays = parseNumber(plays_raw, options.missingAsZero, quality, "plays");
      const comments = parseNumber(comments_raw, options.missingAsZero, quality, "comments");

      // Metrics
      let play_like_ratio = null;
      if (likes === 0 && plays > 0) {
        play_like_ratio = Infinity;
      } else if (likes > 0 && plays >= 0) {
        play_like_ratio = plays / likes;
      }

      let engagement_rate_pct = 0;
      if (plays > 0) {
        engagement_rate_pct = ((likes + reposts + comments) / plays) * 100;
      } else {
        engagement_rate_pct = 0;
        if (options.showQuality) quality.invalid_fields.push("plays_zero_for_rates");
      }

      let like_pct = 0;
      if (plays > 0) {
        like_pct = (likes / plays) * 100;
      } else {
        like_pct = 0;
      }

      const dsu = Number.isFinite(days_since_upload) ? Math.max(1, days_since_upload) : 1;
      const plays_per_day = plays / dsu;

      data.push({
        source_line: lineNo,
        track_raw,
        posted_raw,
        title,
        posted_iso,
        days_since_upload: Number.isFinite(days_since_upload) ? days_since_upload : null,
        likes,
        reposts,
        plays,
        comments,
        play_like_ratio,
        engagement_rate_pct,
        like_pct,
        plays_per_day,
        quality,
        category: "Average", // placeholder, assigned later
      });
    }

    // Quantile thresholds on finite play_like_ratio only
    const finitePLR = data.map(d => d.play_like_ratio).filter(Number.isFinite);
    const thresholds = quantiles(finitePLR);

    for (const d of data) {
      d.category = computeCategory(d.play_like_ratio, d.likes, thresholds);
    }

    // Aggregates
    const totals = data.reduce((acc, d) => {
      acc.plays += d.plays;
      acc.likes += d.likes;
      acc.reposts += d.reposts;
      acc.comments += d.comments;
      return acc;
    }, { plays: 0, likes: 0, reposts: 0, comments: 0 });

    const avgEngagement = (() => {
      const vals = data.map(d => d.engagement_rate_pct).filter(v => Number.isFinite(v));
      if (vals.length === 0) return 0;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    })();

    const medianPLR = median(finitePLR);

    return {
      rows: data,
      totals,
      thresholds,
      avgEngagement,
      medianPLR,
    };
  }

  // High-level entry: parse raw CSV text to processed dataset
  function parseAndProcessCSV(text, options) {
    const rows = parseCSV(text);
    return processDataRows(rows, options);
  }

  // Create CSV string from processed dataset (including derived metrics)
  function toCSV(dataset) {
    const header = [
      "TRACK",
      "POSTED_ISO",
      "DAYS",
      "PLAYS",
      "LIKES",
      "REPOSTS",
      "COMMENTS",
      "PLAY_LIKE_RATIO",
      "ENGAGEMENT_RATE_PCT",
      "LIKE_PCT",
      "PLAYS_PER_DAY",
      "CATEGORY"
    ];
    const lines = [header.join(",")];
    for (const d of dataset.rows) {
      const cells = [
        escapeCSV(d.title),
        d.posted_iso || "",
        valueOrEmpty(d.days_since_upload),
        valueOrEmpty(d.plays),
        valueOrEmpty(d.likes),
        valueOrEmpty(d.reposts),
        valueOrEmpty(d.comments),
        finiteOrEmpty(d.play_like_ratio),
        round2(d.engagement_rate_pct),
        round2(d.like_pct),
        round2(d.plays_per_day),
        d.category
      ];
      lines.push(cells.join(","));
    }
    return lines.join("\n");
  }

  function escapeCSV(s) {
    const str = String(s ?? "");
    if (/[",\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function round2(v) {
    if (!Number.isFinite(v)) return "";
    return (Math.round(v * 100) / 100).toFixed(2);
  }

  function finiteOrEmpty(v) {
    if (!Number.isFinite(v)) return "";
    return String(v);
  }

  function valueOrEmpty(v) {
    if (v === null || v === undefined) return "";
    return String(v);
  }

  // Expose API
  window.Parser = {
    parseCSV,
    parseNumber,
    parseRelativeDate,
    processDataRows,
    parseAndProcessCSV,
    toCSV,
  };
})();