'use strict';

const https = require('https');
const http = require('http');

const VIDSPARK_BASE = 'https://vidspark.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124';

// ── Embed URL builder ─────────────────────────────────────────────────────────
function getEmbedUrl(id, season, episode, theme) {
  let url;
  if (season) {
    url = `${VIDSPARK_BASE}/tv/${id}/${season}/${episode || 1}`;
  } else {
    url = `${VIDSPARK_BASE}/movie/${id}`;
  }
  if (theme) url += `?theme=${encodeURIComponent(theme.replace(/^#/, ''))}`;
  return url;
}

// ── Generic upstream fetcher with redirect support ────────────────────────────
function fetchUpstream(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    (url.startsWith('https') ? https : http).get(url, {
      headers: { Referer: `${VIDSPARK_BASE}/`, Origin: VIDSPARK_BASE, 'User-Agent': UA, Accept: '*/*' }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        return resolve(fetchUpstream(loc.startsWith('http') ? loc : new URL(loc, url).href, redirects + 1));
      }
      resolve(res);
    }).on('error', reject);
  });
}

// ── Vercel serverless handler ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { searchParams } = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(searchParams);

  // Proxy mode: /api?url=... (for subtitles or other external resources)
  if (q.url) {
    const url = decodeURIComponent(q.url);
    try {
      const upstream = await fetchUpstream(url);
      const ct = (upstream.headers['content-type'] || '').toLowerCase();
      res.setHeader('Content-Type', ct || 'application/octet-stream');
      if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
      res.statusCode = upstream.statusCode;
      upstream.pipe(res);
    } catch (err) {
      res.statusCode = 502;
      res.end(err.message);
    }
    return;
  }

  // Embed URL lookup: /api?id=550  or  /api?id=456&s=1&e=2
  if (!q.id) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'missing id' }));
  }

  res.setHeader('Content-Type', 'application/json');
  try {
    const embedUrl = getEmbedUrl(q.id, q.s, q.e, q.theme);
    res.end(JSON.stringify({ embedUrl, source: 'vidspark' }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
};
