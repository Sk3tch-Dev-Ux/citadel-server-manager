/**
 * Steam Workshop search, details, and popular mod routes.
 */
const { enrichWorkshopResults, scrapeWorkshopSearch, DAYZ_APP_ID } = require('../lib/workshop');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/workshop/search', auth(), async (req, res) => {
    const { q, page = 1 } = req.query;
    if (!q || q.trim().length < 2) return res.status(400).json({ error: 'Query too short' });
    try {
      const fetch = (await import('node-fetch')).default;
      const url = `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?query_type=1&page=${page}&numperpage=20&appid=${DAYZ_APP_ID}&search_text=${encodeURIComponent(q.trim())}&return_short_description=true&return_metadata=true&return_previews=true&strip_description_bbcode=true&filetype=0&match_all_tags=false` + (process.env.STEAM_API_KEY ? `&key=${process.env.STEAM_API_KEY}` : '');
      const response = await fetch(url, { timeout: 10000 });
      const data = await response.json();
      if (data.response?.publishedfiledetails && data.response.publishedfiledetails.length > 0) {
        const results = data.response.publishedfiledetails.map(item => ({
          workshopId: item.publishedfileid, name: item.title || 'Unknown',
          description: (item.short_description || '').substring(0, 200),
          preview: item.preview_url || item.previews?.[0]?.url || '',
          subscribers: item.subscriptions || 0, favorites: item.favorited || 0,
          fileSize: item.file_size || 0, updated: item.time_updated ? new Date(item.time_updated * 1000).toISOString() : '',
          tags: (item.tags || []).map(t => t.tag || t.display_name || ''),
        }));
        return res.json({ results, total: data.response.total || results.length, page: parseInt(page) });
      }
      if (data.response?.publishedfileids && data.response.publishedfileids.length > 0) {
        const ids = data.response.publishedfileids.map(f => f.publishedfileid || f);
        const stubItems = ids.map(id => ({ workshopId: String(id), name: '', description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] }));
        const enriched = await enrichWorkshopResults(stubItems);
        return res.json({ results: enriched, total: data.response.total || enriched.length, page: parseInt(page) });
      }
      const results = await scrapeWorkshopSearch(q, page);
      res.json({ results, total: results.length, page: parseInt(page) });
    } catch (err) {
      try { const results = await scrapeWorkshopSearch(q, page); res.json({ results, total: results.length, page: parseInt(page) }); }
      catch { res.status(500).json({ error: 'Workshop search failed' }); }
    }
  });

  app.get('/api/workshop/details/:id', auth(), async (req, res) => {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `itemcount=1&publishedfileids[0]=${req.params.id}`, timeout: 10000,
      });
      const data = await response.json();
      const item = data.response?.publishedfiledetails?.[0];
      if (!item || item.result !== 1) return res.status(404).json({ error: 'Not found' });
      res.json({
        workshopId: item.publishedfileid, name: item.title, description: (item.description || '').substring(0, 500),
        preview: item.preview_url || '', subscribers: item.subscriptions || 0, favorites: item.favorited || 0,
        fileSize: item.file_size || 0, updated: item.time_updated ? new Date(item.time_updated * 1000).toISOString() : '',
        tags: (item.tags || []).map(t => t.tag), steamUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedfileid}`,
      });
    } catch { res.status(500).json({ error: 'Failed to fetch details' }); }
  });

  app.get('/api/workshop/popular', auth(), async (req, res) => {
    try {
      const fetch = (await import('node-fetch')).default;
      const { page = 1 } = req.query;
      const url = `https://steamcommunity.com/workshop/browse/?appid=${DAYZ_APP_ID}&browsesort=trend&section=readytouseitems&p=${page}`;
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, timeout: 15000 });
      const html = await response.text();
      const results = [];
      let match;
      const emptyItem = { description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] };
      const patterns = [
        /data-publishedfileid="(\d+)"[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g,
        /SharedFileBindMouseHover[^"]*"(\d+)"[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g,
        /filedetails\/\?id=(\d+)[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g,
      ];
      for (const p of patterns) {
        if (results.length > 0) break;
        while ((match = p.exec(html)) !== null) {
          if (!results.find(r => r.workshopId === match[1])) results.push({ workshopId: match[1], name: match[2].trim(), ...emptyItem });
        }
      }
      if (results.length === 0) {
        const idSet = new Set();
        const fp = /filedetails\/\?id=(\d+)/g;
        while ((match = fp.exec(html)) !== null) idSet.add(match[1]);
        for (const id of idSet) results.push({ workshopId: id, name: '', ...emptyItem });
      }
      res.json({ results: await enrichWorkshopResults(results), total: results.length, page: parseInt(page) });
    } catch { res.status(500).json({ error: 'Failed to fetch popular mods' }); }
  });
};
