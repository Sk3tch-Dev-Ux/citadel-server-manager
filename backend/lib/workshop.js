/**
 * Steam Workshop search and enrichment.
 * Scrapes the Steam Workshop HTML and enriches results via the Steam API.
 */
const logger = require('./logger');

const DAYZ_APP_ID = 221100;

/**
 * Enrich workshop items with full details from the Steam API.
 */
async function enrichWorkshopResults(items) {
  if (items.length === 0) return items;
  try {
    const params = new URLSearchParams();
    params.append('itemcount', items.length);
    items.forEach((item, i) => params.append(`publishedfileids[${i}]`, item.workshopId));
    const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    const details = data.response?.publishedfiledetails || [];
    return items.map(item => {
      const d = details.find(x => x.publishedfileid === item.workshopId);
      if (d && d.result === 1) return {
        ...item, name: d.title || item.name,
        description: (d.description || '').replace(/\[.*?\]/g, '').substring(0, 200),
        preview: d.preview_url || item.preview, subscribers: d.subscriptions || 0,
        favorites: d.favorited || 0, fileSize: d.file_size || 0,
        updated: d.time_updated ? new Date(d.time_updated * 1000).toISOString() : '',
        tags: (d.tags || []).map(t => t.tag),
      };
      return item;
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to enrich workshop results');
    return items;
  }
}

/**
 * Scrape Steam Workshop search results page for DayZ mods.
 * Uses multiple regex patterns to handle different Steam HTML layouts.
 */
async function scrapeWorkshopSearch(query, page) {
  const url = `https://steamcommunity.com/workshop/browse/?appid=${DAYZ_APP_ID}&searchtext=${encodeURIComponent(query)}&browsesort=textsearch&section=readytouseitems&actualsort=textsearch&p=${page}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(15000) });
  const html = await response.text();
  const results = [];
  let match;
  const emptyItem = { description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] };

  // Pattern 1: data-publishedfileid attribute (modern Steam Workshop HTML)
  const p1 = /data-publishedfileid="(\d+)"[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g;
  while ((match = p1.exec(html)) !== null) {
    if (!results.find(r => r.workshopId === match[1])) results.push({ workshopId: match[1], name: match[2].trim(), ...emptyItem });
  }
  // Pattern 2: SharedFileBindMouseHover
  if (results.length === 0) {
    const p2 = /SharedFileBindMouseHover[^"]*"(\d+)"[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g;
    while ((match = p2.exec(html)) !== null) {
      if (!results.find(r => r.workshopId === match[1])) results.push({ workshopId: match[1], name: match[2].trim(), ...emptyItem });
    }
  }
  // Pattern 3: workshopItem block with filedetails link
  if (results.length === 0) {
    const p3 = /workshopItem[^>]*>[\s\S]*?filedetails\/\?id=(\d+)[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g;
    while ((match = p3.exec(html)) !== null) {
      if (!results.find(r => r.workshopId === match[1])) results.push({ workshopId: match[1], name: match[2].trim(), ...emptyItem });
    }
  }
  // Pattern 4: simple filedetails link + title
  if (results.length === 0) {
    const p4 = /filedetails\/\?id=(\d+)[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g;
    while ((match = p4.exec(html)) !== null) {
      if (!results.find(r => r.workshopId === match[1])) results.push({ workshopId: match[1], name: match[2].trim(), ...emptyItem });
    }
  }
  // Pattern 5: just extract any filedetails IDs and enrich them
  if (results.length === 0) {
    const idSet = new Set();
    const p5 = /filedetails\/\?id=(\d+)/g;
    while ((match = p5.exec(html)) !== null) idSet.add(match[1]);
    for (const id of idSet) results.push({ workshopId: id, name: '', ...emptyItem });
  }
  return enrichWorkshopResults(results);
}

module.exports = { enrichWorkshopResults, scrapeWorkshopSearch, DAYZ_APP_ID };
