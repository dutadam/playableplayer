// IPTV Proxy Worker — Cloudflare Workers
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');

    if (!target) {
      return new Response('IPTV Proxy aktif.\nKullanim: /?url=http://sunucu:8080/get.php?...', {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return new Response('Gecersiz URL', { status: 400, headers: CORS });
    }

    const fetchWithTimeout = (url, opts, ms) => Promise.race([
      fetch(url, opts),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sunucu yanit vermedi (' + ms / 1000 + 's)')), ms)
      ),
    ]);

    try {
      const resp = await fetchWithTimeout(targetUrl.toString(), {
        headers: {
          'User-Agent': 'VLC/3.0 LibVLC/3.0',
          'Accept': '*/*',
        },
      }, 15000);

      const ct = (resp.headers.get('Content-Type') || '').toLowerCase();
      const isPlaylist =
        ct.includes('mpegurl') ||
        ct.includes('text/plain') ||
        targetUrl.pathname.includes('.m3u') ||
        targetUrl.pathname.includes('get.php');

      if (isPlaylist && resp.ok) {
        const text = await resp.text();
        const origin = reqUrl.origin;
        const rewritten = text.split('\n').map(line => {
          const t = line.trim();
          if (t.startsWith('http://') || t.startsWith('https://')) {
            return `${origin}/?url=${encodeURIComponent(t)}`;
          }
          return line;
        }).join('\n');
        return new Response(rewritten, {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8' },
        });
      }

      const headers = { ...CORS, 'Content-Type': ct || 'application/octet-stream' };
      return new Response(resp.body, { status: resp.status, headers });

    } catch (e) {
      return new Response('Proxy hatasi: ' + e.message, { status: 502, headers: CORS });
    }
  },
};
