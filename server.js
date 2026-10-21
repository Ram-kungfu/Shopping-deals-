require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const searchCache = new Map();
const CACHE_EXPIRY_MS = 6 * 60 * 60 * 1000; // असली भाव बदलते रहते हैं, इसलिए 6 घंटे

// ==================== STORE LINK CONFIG ====================
const STORES = {
  // ---------- RETAIL ----------
  amazon:   { type: 'q', base: 'https://www.amazon.in/s?k=', env: 'AMAZON_AFF_ID', param: 'tag', name: 'Amazon' },
  flipkart: { type: 'q', base: 'https://www.flipkart.com/search?q=', env: 'FLIPKART_AFF_ID', param: 'affid', name: 'Flipkart' },
  meesho:   { type: 'q', base: 'https://www.meesho.com/search?q=', env: 'MEESHO_AFF_ID', param: 'utm_source', name: 'Meesho' },
  myntra:   { type: 'path', base: 'https://www.myntra.com/', hyphen: true, env: 'MYNTRA_AFF_ID', param: 'utm_source', name: 'Myntra' },
  ajio:     { type: 'q', base: 'https://www.ajio.com/search/?text=', env: 'AJIO_AFF_ID', param: 'utm_source', name: 'Ajio' },
  tatacliq: { type: 'q', base: 'https://www.tatacliq.com/search/?searchCategory=all&text=', env: 'TATACLIQ_AFF_ID', param: 'utm_source', name: 'TataCLiQ' },
  jiomart:  { type: 'path', base: 'https://www.jiomart.com/search/', env: 'JIOMART_AFF_ID', param: 'utm_source', name: 'JioMart' },
  shopclues:{ type: 'google', label: 'ShopClues', name: 'ShopClues' },

  // ---------- QUICK COMMERCE & GROCERY ----------
  blinkit:   { type: 'q', base: 'https://blinkit.com/s/?q=', env: 'BLINKIT_AFF_ID', param: 'utm_source', name: 'Blinkit' },
  zepto:     { type: 'q', base: 'https://www.zeptonow.com/search?query=', env: 'ZEPTO_AFF_ID', param: 'utm_source', name: 'Zepto' },
  instamart: { type: 'q', base: 'https://www.swiggy.com/instamart/search?custom_back=true&query=', env: 'INSTAMART_AFF_ID', param: 'utm_source', name: 'Instamart' },
  bigbasket: { type: 'q', base: 'https://www.bigbasket.com/ps/?q=', env: 'BIGBASKET_AFF_ID', param: 'utm_source', name: 'BigBasket' },

  // ---------- WHOLESALE / B2B ----------
  indiamart:         { type: 'q', base: 'https://dir.indiamart.com/search.mp?ss=', env: 'INDIAMART_AFF_ID', param: 'utm_source', name: 'IndiaMART' },
  udaan:             { type: 'q', base: 'https://www.udaan.com/search?q=', env: 'UDAAN_AFF_ID', param: 'utm_source', name: 'Udaan' },
  tradeindia:        { type: 'q', base: 'https://www.tradeindia.com/search.html?keyword=', env: 'TRADEINDIA_AFF_ID', param: 'utm_source', name: 'TradeIndia' },
  flipkartwholesale: { type: 'q', base: 'https://www.flipkart.com/search?q=', env: 'FLIPKART_AFF_ID', param: 'affid', name: 'Flipkart Wholesale' },
  jumbotail:         { type: 'q', base: 'https://jumbotail.com/search?q=', env: 'JUMBOTAIL_AFF_ID', param: 'utm_source', name: 'Jumbotail' },
  ninjacart:         { type: 'q', base: 'https://ninjacart.in/search?q=', env: 'NINJACART_AFF_ID', param: 'utm_source', name: 'NinjaCart' },

  // ---------- COMMERCIAL / INDUSTRIAL ----------
  amazonbusiness: { type: 'q', base: 'https://www.amazon.in/s?k=', env: 'AMAZON_AFF_ID', param: 'tag', name: 'Amazon Business' },
  moglix:         { type: 'q', base: 'https://www.moglix.com/search?q=', env: 'MOGLIX_AFF_ID', param: 'utm_source', name: 'Moglix' },
  industrybuying: { type: 'q', base: 'https://www.industrybuying.com/search/?q=', env: 'INDUSTRYBUYING_AFF_ID', param: 'utm_source', name: 'IndustryBuying' },

  // ---------- GLOBAL ----------
  alibaba: { type: 'q', base: 'https://www.alibaba.com/trade/search?SearchText=', env: 'ALIBABA_AFF_ID', param: 'aff_id', name: 'Alibaba' },

  // ---------- RESELLING ----------
  glowroad: { type: 'google', label: 'GlowRoad', name: 'GlowRoad' },
  shop101:  { type: 'google', label: 'Shop101', name: 'Shop101' },
  navo:     { type: 'q', base: 'https://navo.app/search?q=', env: 'NAVO_AFF_ID', param: 'utm_source', name: 'Navo' }
};

const CATEGORY_STORES = {
  retail: ['amazon', 'flipkart', 'myntra', 'ajio', 'tatacliq', 'jiomart', 'meesho'],
  wholesale: ['indiamart', 'udaan', 'tradeindia', 'flipkartwholesale', 'jumbotail', 'ninjacart'],
  reselling: ['meesho', 'navo', 'glowroad', 'shop101'],
  grocery: ['blinkit', 'zepto', 'instamart', 'bigbasket'],
  commercial: ['moglix', 'industrybuying', 'amazonbusiness'],
  global: ['alibaba']
};

const CATEGORY_INFO = {
  retail:     { badge: 'Retail / Consumer',       label: 'Retail' },
  wholesale:  { badge: 'Wholesale / B2B',         label: 'थोक / B2B' },
  reselling:  { badge: 'Reselling & Social',      label: 'रीसेलिंग' },
  grocery:    { badge: 'Grocery & Quick',         label: 'ग्रोसरी' },
  commercial: { badge: 'Commercial / Industrial', label: 'कमर्शियल' },
  global:     { badge: 'Global / Import',         label: 'ग्लोबल' }
};

// ==================== HELPERS ====================
function googleLink(query, label) {
  return `https://www.google.com/search?q=${encodeURIComponent((query + ' ' + (label || '') + ' buy online').trim())}`;
}

function realValue(v) {
  return v && !/^YOUR_/i.test(v) ? v : '';
}

function withAffiliate(url, store) {
  const id = realValue(store.env ? process.env[store.env] : '');
  if (!id) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${store.param}=${encodeURIComponent(id)}`;
}

function buildAffiliateLink(storeKey, query, storeName) {
  const key = String(storeKey || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const store = STORES[key];
  const q = String(query || '').trim();
  if (!store) return googleLink(q, storeName);
  if (store.type === 'google') return googleLink(q, store.label);

  let url;
  if (store.type === 'path') {
    const slug = store.hyphen ? encodeURIComponent(q.replace(/\s+/g, '-')) : encodeURIComponent(q);
    url = store.base + slug;
  } else {
    url = store.base + encodeURIComponent(q);
  }
  return withAffiliate(url, store);
}

function placeholderImage(text) {
  const label = String(text || 'Product').slice(0, 24).replace(/[<>&"']/g, '');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250" viewBox="0 0 250 250">` +
    `<rect width="250" height="250" fill="#e2e8f0"/>` +
    `<text x="125" y="130" font-family="Arial, sans-serif" font-size="18" fill="#475569" text-anchor="middle">${label}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// "₹12,999" → 12999, "Rs. 1,299.50" → 1299.5
function priceToNumber(price) {
  const m = String(price || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/g, ' ').trim();
}

// ==================== SERPER (असली भाव) ====================
const SERPER_KEY = realValue(process.env.SERPER_API_KEY);

async function serperShopping(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch('https://google.serper.dev/shopping', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'in', hl: 'en', num: 40 }),
      signal: controller.signal
    });
    if (!r.ok) throw new Error('Serper HTTP ' + r.status);
    const d = await r.json();
    return Array.isArray(d.shopping) ? d.shopping : [];
  } finally {
    clearTimeout(timer);
  }
}

// दुकान का नाम (source) → हमारी स्टोर key
function storeKeyFromSource(source) {
  const s = normalizeText(source).replace(/\s+/g, '');
  const known = ['amazon', 'flipkart', 'meesho', 'myntra', 'ajio', 'tatacliq', 'jiomart', 'blinkit', 'zepto', 'bigbasket', 'indiamart', 'alibaba', 'moglix', 'industrybuying'];
  return known.find(k => s.includes(k)) || null;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

const ACCESSORY_WORDS = ['case', 'cover', 'charger', 'protector', 'tempered', 'glass', 'cable', 'adapter', 'pouch', 'skin', 'strap', 'holder', 'stand'];

// सिर्फ वही नतीजे जिनके नाम में आपके खोजे सारे शब्द हों
function isRelevant(title, queryTokens, rawQuery) {
  const t = normalizeText(title);
  if (!queryTokens.every(tok => t.includes(tok))) return false;
  const q = normalizeText(rawQuery);
  for (const w of ACCESSORY_WORDS) {
    if (t.split(' ').includes(w) && !q.split(' ').includes(w)) return false;
  }
  return true;
}

function buildRetailCards(results, query) {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  const groups = new Map();

  results.forEach((r, pos) => {
    if (!r || !r.title || !r.source) return;
    const num = priceToNumber(r.price);
    if (num === null || num <= 0) return;
    if (!isRelevant(r.title, tokens, query)) return;

    const gk = normalizeText(r.title);
    if (!groups.has(gk)) {
      groups.set(gk, { title: String(r.title), image: r.imageUrl || '', firstPos: pos, offers: new Map() });
    }
    const g = groups.get(gk);
    if (!g.image && r.imageUrl) g.image = r.imageUrl;

    // एक दुकान की सबसे सस्ती पेशकश रखें
    const sk = normalizeText(r.source);
    const old = g.offers.get(sk);
    if (!old || num < old.num) {
      g.offers.set(sk, { source: String(r.source), num, priceText: String(r.price), link: String(r.link || '') });
    }
  });

  const sorted = [...groups.values()].sort((a, b) =>
    (b.offers.size - a.offers.size) || (a.firstPos - b.firstPos)
  ).slice(0, 6);

  return sorted.map(g => {
    const offers = [...g.offers.values()].sort((a, b) => a.num - b.num);
    const stores = offers.map(o => {
      const key = storeKeyFromSource(o.source);
      const store = key ? STORES[key] : null;
      let link;
      if (store && store.base && hostOf(o.link) && hostOf(o.link).endsWith(hostOf(store.base))) {
        link = withAffiliate(o.link, store); // दुकान का सीधा प्रोडक्ट लिंक + आपकी ID
      } else if (key) {
        link = buildAffiliateLink(key, makeSearchTerm(g.title, query), o.source); // पूरे नाम से सर्च
      } else {
        link = o.link || googleLink(g.title, o.source);
      }
      return {
        name: store ? store.name : o.source,
        price: o.priceText,
        isLowest: false,
        link,
        altLink: o.link && /^https?:\/\//i.test(o.link) ? o.link : googleLink(g.title, o.source),
        _num: o.num
      };
    });

    if (stores.length >= 2) stores[0].isLowest = true; // stores पहले से सस्ते→महँगे क्रम में हैं
    stores.forEach(s => delete s._num);

    return {
      category: 'retail',
      title: g.title,
      image: g.image && /^https:\/\//i.test(g.image) ? g.image : placeholderImage(g.title),
      badgeText: CATEGORY_INFO.retail.badge,
      stores
    };
  });
}

function makeSearchTerm(title, fallback) {
  const cleaned = String(title || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return cleaned || fallback;
}

// जिन कैटेगरी का असली भाव स्रोत नहीं है: "भाव देखें" + खरीदें बटन
function buildLinkOnlyCard(category, query) {
  const keys = CATEGORY_STORES[category] || [];
  const stores = keys.map(k => {
    const cfg = STORES[k];
    return {
      name: cfg.name,
      price: 'भाव देखें',
      isLowest: false,
      link: buildAffiliateLink(k, query, cfg.name),
      altLink: (k === 'meesho' || k === 'udaan') ? googleLink(query, cfg.name) : null
    };
  });
  return {
    category,
    title: `${query} — ${CATEGORY_INFO[category].label}`,
    image: placeholderImage(query),
    badgeText: CATEGORY_INFO[category].badge,
    stores
  };
}

// ==================== SEARCH API ====================
app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || !String(query).trim()) {
      return res.status(400).json({ success: false, error: 'Search query required' });
    }
    const cleanQuery = String(query).trim().toLowerCase().slice(0, 100);

    const cached = searchCache.get(cleanQuery);
    if (cached) {
      if (Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
        return res.json({ success: true, products: cached.products, fromCache: true });
      }
      searchCache.delete(cleanQuery);
    }

    let retailCards = [];
    let serperOk = false;

    if (SERPER_KEY) {
      try {
        const results = await serperShopping(cleanQuery);
        retailCards = buildRetailCards(results, cleanQuery);
        serperOk = true;
      } catch (e) {
        console.error('Serper error:', e.message);
      }
    } else {
      console.warn('⚠️  SERPER_API_KEY not set — भाव नहीं दिखेंगे, सिर्फ "भाव देखें" वाले कार्ड बनेंगे।');
    }

    // Serper न चले तो रिटेल भी "भाव देखें" वाला कार्ड बनेगा (नकली भाव कभी नहीं)
    if (!serperOk) retailCards = [buildLinkOnlyCard('retail', cleanQuery)];

    const products = [
      ...retailCards,
      buildLinkOnlyCard('wholesale', cleanQuery),
      buildLinkOnlyCard('reselling', cleanQuery),
      buildLinkOnlyCard('grocery', cleanQuery),
      buildLinkOnlyCard('commercial', cleanQuery),
      buildLinkOnlyCard('global', cleanQuery)
    ];

    if (serperOk) {
      searchCache.set(cleanQuery, { products, timestamp: Date.now() });
    }

    return res.json({ success: true, products });
  } catch (err) {
    console.error('Search endpoint error:', err);
    return res.status(500).json({ success: false, error: 'Server error. Please retry.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', serper: !!SERPER_KEY, cachedItems: searchCache.size, timestamp: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🛒 Shopping Deals Server running on port ${PORT}`);
  console.log(`🔎 Serper (असली भाव): ${SERPER_KEY ? '✅ Active' : '⚠️  SERPER_API_KEY not set'}`);
});
