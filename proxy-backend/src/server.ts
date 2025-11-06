import express from 'express';
import helmet from 'helmet';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import qs from 'qs';

const app = express();
app.use(helmet());
app.use(express.json());

const dom = new JSDOM('');
const DOMPurify = createDOMPurify(dom.window as any);

const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').filter(Boolean);

// helper: allow all hosts if ALLOWED_HOSTS empty? Better to require config.
// For safety in dev, allow localhost if empty:
function isAllowedHost(hostname: string) {
  if (ALLOWED_HOSTS.length === 0) return true;
  return ALLOWED_HOSTS.includes(hostname);
}

function resolveAbsoluteUrl(base: string, maybe: string) {
  try {
    return new URL(maybe, base).href;
  } catch {
    return null;
  }
}

/**
 * Rewrites HTML so that all resource links (a[href], img[src], script[src], link[href], form[action])
 * point to our proxy endpoints (/proxy_backend?url=...) so subsequent loads go through the proxy.
 */
function rewriteHtml(baseUrl: string, html: string) {
  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;

  // helper to rewrite a URL attribute to proxy
  const rewriteAttr = (el: Element, attr: string) => {
    const val = el.getAttribute(attr);
    if (!val) return;
    const abs = resolveAbsoluteUrl(baseUrl, val);
    if (!abs) return;
    // for javascript: and data: skip rewriting for safety
    if (/^\s*(javascript|data):/i.test(val)) return;
    el.setAttribute(attr, `/proxy_backend?url=${encodeURIComponent(abs)}`);
  };

  // anchors
  doc.querySelectorAll('a[href]').forEach(a => rewriteAttr(a, 'href'));
  // images
  doc.querySelectorAll('img[src]').forEach(img => rewriteAttr(img, 'src'));
  // scripts
  doc.querySelectorAll('script[src]').forEach(s => rewriteAttr(s, 'src'));
  // links (css)
  doc.querySelectorAll('link[href]').forEach(l => rewriteAttr(l, 'href'));
  // forms
  doc.querySelectorAll('form[action]').forEach(f => rewriteAttr(f, 'action'));

  // optionally remove Content-Security-Policy meta tags to avoid blocking (we don't add bypassing code)
  doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(m => m.remove());

  return doc.documentElement.outerHTML;
}

// --- /search endpoint using DuckDuckGo Instant Answer API ---
app.get('/search', async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q) return res.status(400).json({ error: 'missing q' });
  try {
    const apiUrl = 'https://api.duckduckgo.com/?' + qs.stringify({ q, format: 'json', no_html: 1, skip_disambig: 1 });
    const r = await fetch(apiUrl);
    if (!r.ok) return res.status(502).json({ error: 'search-provider-failed', status: r.status });
    const j = await r.json();

    const results: Array<{ title: string; url?: string; snippet?: string }> = [];

    if (Array.isArray(j.Results) && j.Results.length) {
      for (const it of j.Results) {
        if (it && it.FirstURL && it.Text) {
          results.push({ title: it.Text, url: it.FirstURL, snippet: it.Result || '' });
        }
      }
    }
    if (Array.isArray(j.RelatedTopics)) {
      for (const t of j.RelatedTopics) {
        if (t.Topics && Array.isArray(t.Topics)) {
          for (const s of t.Topics) {
            if (s.FirstURL && s.Text) results.push({ title: s.Text, url: s.FirstURL });
          }
        } else {
          if (t.FirstURL && t.Text) results.push({ title: t.Text, url: t.FirstURL });
        }
      }
    }
    if (j.AbstractURL || j.AbstractText) {
      results.unshift({
        title: j.Heading || j.AbstractText || 'Summary',
        url: j.AbstractURL || undefined,
        snippet: j.AbstractText || undefined
      });
    }

    res.json({ query: q, results: results.slice(0, 30) });
  } catch (err: any) {
    console.error('search error', err);
    res.status(500).json({ error: err.message || 'unknown' });
  }
});

// --- main proxy endpoint: fetch target, optionally rewrite HTML and sanitize ---
app.get('/proxy_backend', async (req, res) => {
  const target = req.query.url as string | undefined;
  if (!target) return res.status(400).send('missing url');
  const parsed = (() => { try { return new URL(target); } catch { return null; } })();
  if (!parsed) return res.status(400).send('invalid url');
  if (!isAllowedHost(parsed.hostname)) return res.status(403).send('host not allowed');

  try {
    const upstream = await fetch(target, { redirect: 'follow' });
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

    // for HTML we sanitize + rewrite links
    if (contentType.includes('text/html')) {
      let body = await upstream.text();
      // sanitize to remove scripts potentially harmful
      body = DOMPurify.sanitize(body);
      // rewrite links to pass through our proxy
      body = rewriteHtml(target, body);
      // set safe headers
      res.set('Content-Type', 'text/html; charset=utf-8');
      // prevent embedding by other sites
      res.set('X-Frame-Options', 'SAMEORIGIN');
      res.send(body);
      return;
    }

    // For other content types (images, css, js), proxy the bytes directly
    const buffer = await upstream.arrayBuffer();
    res.set('Content-Type', contentType);
    res.send(Buffer.from(buffer));
  } catch (err: any) {
    console.error('proxy error', err);
    res.status(502).send('fetch error: ' + (err.message || 'unknown'));
  }
});

// a simple health endpoint
app.get('/health', (req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`proxy-backend listening ${port}`));
