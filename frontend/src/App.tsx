import React, { useState, useRef } from 'react';

type SearchResult = { title: string; url?: string; snippet?: string };

export default function App() {
  const [url, setUrl] = useState('https://example.com');
  const [mode, setMode] = useState<'proxy' | 'render'>('proxy');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [pos, setPos] = useState<number>(-1);

  function openUrl(targetUrl: string) {
    const endpoint =
      mode === 'proxy'
        ? `/proxy_backend?url=${encodeURIComponent(targetUrl)}`
        : `/render?url=${encodeURIComponent(targetUrl)}`;
    if (iframe.current) iframe.current.src = endpoint;

    setHistory(prev => {
      const trimmed = pos >= 0 && pos < prev.length - 1 ? prev.slice(0, pos + 1) : prev.slice();
      const next = [...trimmed, targetUrl];
      setPos(next.length - 1);
      return next;
    });
  }

  function go() {
    if (!url) return;
    openUrl(url);
  }

  function doSearch() {
    if (!query.trim()) return;
    setLoading(true);
    fetch(`/search?q=${encodeURIComponent(query)}`)
      .then(r => r.json())
      .then(j => setResults(j.results || []))
      .catch(e => { console.error(e); setResults([]); })
      .finally(() => setLoading(false));
  }

  function onResultClick(r: SearchResult) {
    if (r.url) openUrl(r.url);
    else if (r.snippet) {
      // show snippet using srcdoc
      if (iframe.current) iframe.current.srcdoc = `<pre>${String(r.snippet).replace(/</g, '&lt;')}</pre>`;
      setHistory(prev => { const next = [...prev.slice(0, pos+1), 'about:snippet']; setPos(next.length-1); return next; });
    }
  }

  function goBack() {
    if (pos > 0) {
      const newPos = pos - 1;
      setPos(newPos);
      const target = history[newPos];
      if (target === 'about:snippet') {
        if (iframe.current) iframe.current.srcdoc = '<div>Snippet</div>';
      } else {
        openUrl(target);
      }
    }
  }
  function goForward() {
    if (pos < history.length - 1) {
      const newPos = pos + 1;
      setPos(newPos);
      const target = history[newPos];
      if (target === 'about:snippet') {
        if (iframe.current) iframe.current.srcdoc = '<div>Snippet</div>';
      } else {
        openUrl(target);
      }
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <h2>Search + Proxy UI (Google-like)</h2>

      <div style={{ marginBottom: 12 }}>
        <input
          placeholder="Search (DuckDuckGo Instant Answer)"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ width: '40%', padding: 8 }}
        />
        <button onClick={doSearch} disabled={loading} style={{ marginLeft: 8 }}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ width: '34%', maxHeight: '72vh', overflow: 'auto', border: '1px solid #ddd', padding: 10 }}>
          <h4>Results</h4>
          {results.length === 0 && <div style={{ color: '#888' }}>No results</div>}
          {results.map((r, i) => (
            <div key={i} style={{ marginBottom: 8, cursor: r.url ? 'pointer' : 'default' }} onClick={() => onResultClick(r)}>
              <div style={{ fontWeight: 600 }}>{r.title}</div>
              {r.snippet && <div style={{ fontSize: 12, color: '#444' }}>{r.snippet}</div>}
              {r.url && <div style={{ fontSize: 12, color: '#06c' }}>{r.url}</div>}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 8 }}>
            <input style={{ width: '60%', padding: 6 }} value={url} onChange={e => setUrl(e.target.value)} />
            <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ marginLeft: 6 }}>
              <option value="proxy">Proxy</option>
              <option value="render">Render</option>
            </select>
            <button onClick={go} style={{ marginLeft: 6 }}>Go</button>
            <button onClick={goBack} style={{ marginLeft: 8 }}>← Back</button>
            <button onClick={goForward} style={{ marginLeft: 4 }}>→ Forward</button>
          </div>

          <iframe
            ref={iframe}
            style={{ width: '100%', height: '72vh', border: '1px solid #ccc' }}
            sandbox="allow-samesite allow-scripts allow-same-origin allow-forms"
          />
        </div>
      </div>
    </div>
  );
}
