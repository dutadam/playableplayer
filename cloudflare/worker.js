// IPTV Proxy Worker — Cloudflare Workers
// HTTP IPTV sunucularını HTTPS olarak proxy'ler, M3U/m3u8 içindeki URL'leri yeniden yazar

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
    } catch {
      return new Response('Gecersiz URL', { status: 400, headers: CORS });
    }

    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return new Response('Sadece HTTP/HTTPS desteklenir', { status: 400, headers: CORS });
    }

    try {
      const resp = await fetch(targetUrl.toString(), {
        headers: {
          'User-Agent': 'VLC/3.0 LibVLC/3.0',
          'Accept': '*/*',
        },
        signal: AbortSignal.timeout(30000),
      });

      const ct = (resp.headers.get('Content-Type') || '').toLowerCase();
      const isPlaylist =
        ct.includes('mpegurl') ||
        ct.includes('text/plain') ||
        targetUrl.pathname.includes('.m3u') ||
        targetUrl.pathname.includes('get.php');

      if (isPlaylist && resp.ok) {
        const text = await resp.text();
        const origin = reqUrl.origin;

        // M3U/m3u8 içindeki http:// URL'lerini Worker'dan geçirecek şekilde yeniden yaz
        const rewritten = text.split('\n').map(line => {
          const t = line.trim();
          if (t.startsWith('http://') || (t.startsWith('https://') && !t.startsWith(origin))) {
            return `${origin}/?url=${encodeURIComponent(t)}`;
          }
          return line;
        }).join('\n');

        return new Response(rewritten, {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8' },
        });
      }

      // Stream ve diğer içerikler: doğrudan ilet
      const headers = { ...CORS, 'Content-Type': ct || 'application/octet-stream' };
      const cl = resp.headers.get('Content-Length');
      if (cl) headers['Content-Length'] = cl;

      return new Response(resp.body, { status: resp.status, headers });

    } catch (e) {
      return new Response('Proxy hatasi: ' + e.message, { status: 502, headers: CORS });
    }
  },
};
