/**
 * Steam Workshop search and enrichment.
 * Scrapes the Steam Workshop HTML and enriches results via the Steam API.
 * Includes rate limiting to prevent API throttling.
 */
const logger = require('./logger');

const DAYZ_APP_ID = 221100;

// ─── Rate Limiter (Token Bucket Algorithm) ───────────────────
// Per-IP rate limiting: max 10 requests/minute, max 100 requests/hour
const rateLimitState = new Map(); // Map<ipAddress, { tokensPerMin, tokensPerHour, lastRefillMin, lastRefillHour }>

const RATE_LIMIT_CONFIG = {
  perMinute: 10,
  perHour: 100,
  minRetryDelayMs: 1000,
  maxRetryDelayMs: 60000,
};

/**
 * Get or initialize rate limit state for an IP address.
 */
function getRateLimitState(ipAddress) {
  const now = Date.now();
  if (!rateLimitState.has(ipAddress)) {
    rateLimitState.set(ipAddress, {
      tokensPerMin: RATE_LIMIT_CONFIG.perMinute,
      tokensPerHour: RATE_LIMIT_CONFIG.perHour,
      lastRefillMin: now,
      lastRefillHour: now,
    });
  }
  return rateLimitState.get(ipAddress);
}

/**
 * Check if a request is allowed under rate limits. Returns { allowed, retryAfterMs }.
 * Uses token bucket algorithm with separate per-minute and per-hour limits.
 */
function checkRateLimit(ipAddress) {
  const state = getRateLimitState(ipAddress);
  const now = Date.now();

  // Refill per-minute tokens (every 60 seconds)
  const minuteSinceRefill = (now - state.lastRefillMin) / 1000 / 60;
  if (minuteSinceRefill >= 1) {
    state.tokensPerMin = Math.min(RATE_LIMIT_CONFIG.perMinute, state.tokensPerMin + minuteSinceRefill * RATE_LIMIT_CONFIG.perMinute);
    state.lastRefillMin = now;
  }

  // Refill per-hour tokens (every 3600 seconds)
  const hourSinceRefill = (now - state.lastRefillHour) / 1000 / 3600;
  if (hourSinceRefill >= 1) {
    state.tokensPerHour = Math.min(RATE_LIMIT_CONFIG.perHour, state.tokensPerHour + hourSinceRefill * RATE_LIMIT_CONFIG.perHour);
    state.lastRefillHour = now;
  }

  // Check if both limits allow the request
  if (state.tokensPerMin > 0 && state.tokensPerHour > 0) {
    state.tokensPerMin -= 1;
    state.tokensPerHour -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  // Calculate retry time (when the next token becomes available)
  const minRetry = state.tokensPerMin <= 0 ? 60000 / RATE_LIMIT_CONFIG.perMinute : Infinity;
  const hourRetry = state.tokensPerHour <= 0 ? 3600000 / RATE_LIMIT_CONFIG.perHour : Infinity;
  const retryAfterMs = Math.min(minRetry, hourRetry);

  return { allowed: false, retryAfterMs };
}

/**
 * Wrapper for fetch with exponential backoff and rate limiting.
 * Automatically retries on 429 (Too Many Requests) with exponential backoff.
 */
async function fetchWithRateLimit(url, options = {}, ipAddress = '0.0.0.0') {
  const { maxRetries = 5, initialDelayMs = RATE_LIMIT_CONFIG.minRetryDelayMs } = options;

  // Pre-flight rate limit check
  const limitCheck = checkRateLimit(ipAddress);
  if (!limitCheck.allowed) {
    logger.warn({ ipAddress, retryAfterMs: limitCheck.retryAfterMs }, 'Rate limit exceeded, waiting before retry');
    await new Promise(r => setTimeout(r, Math.min(limitCheck.retryAfterMs, RATE_LIMIT_CONFIG.maxRetryDelayMs)));
  }

  let lastErr = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Handle 429 (Rate Limited) with exponential backoff
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
        const delayMs = retryAfter * 1000 || initialDelayMs * Math.pow(2, attempt);
        logger.warn({ url, attempt, delayMs, status: 429 }, 'API rate limited, backing off');

        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.min(delayMs, RATE_LIMIT_CONFIG.maxRetryDelayMs)));
          continue;
        }
      }

      return response;
    } catch (err) {
      lastErr = err;
      logger.debug({ err, url, attempt }, 'Fetch error, retrying');
      if (attempt < maxRetries - 1) {
        const delayMs = initialDelayMs * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, Math.min(delayMs, RATE_LIMIT_CONFIG.maxRetryDelayMs)));
      }
    }
  }

  throw lastErr || new Error(`Failed after ${maxRetries} retries`);
}

/**
 * Enrich workshop items with full details from the Steam API.
 * Includes rate limiting and retry logic.
 */
async function enrichWorkshopResults(items, ipAddress = '0.0.0.0') {
  if (items.length === 0) return items;
  try {
    const params = new URLSearchParams();
    params.append('itemcount', items.length);
    items.forEach((item, i) => params.append(`publishedfileids[${i}]`, item.workshopId));

    const response = await fetchWithRateLimit(
      'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
        maxRetries: 3,
      },
      ipAddress
    );

    if (!response.ok) {
      logger.warn({ status: response.status, statusText: response.statusText }, 'Steam API enrichment request failed');
      return items;
    }

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
 * Includes rate limiting to respect Steam API constraints.
 */
async function scrapeWorkshopSearch(query, page, ipAddress = '0.0.0.0') {
  const url = `https://steamcommunity.com/workshop/browse/?appid=${DAYZ_APP_ID}&searchtext=${encodeURIComponent(query)}&browsesort=textsearch&section=readytouseitems&actualsort=textsearch&p=${page}`;

  const response = await fetchWithRateLimit(
    url,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15000),
      maxRetries: 3,
    },
    ipAddress
  );

  if (!response.ok) {
    logger.warn({ status: response.status, url }, 'Workshop search page request failed');
    return [];
  }

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

  return enrichWorkshopResults(results, ipAddress);
}

module.exports = {
  enrichWorkshopResults,
  scrapeWorkshopSearch,
  DAYZ_APP_ID,
  checkRateLimit,
  fetchWithRateLimit,
};
