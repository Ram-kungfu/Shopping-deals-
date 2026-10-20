require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const searchCache = new Map();
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;

// ==================== STORE LINK CONFIG ====================
// type 'q'    : base + खोज शब्द + (अगर ID है तो) affiliate पैरामीटर
// type 'path' : खोज शब्द URL के रास्ते में जाता है (Myntra, JioMart)
// type 'google': साइट बंद/अस्थिर है, इसलिए Google खोज खुलेगी
// env  : Render Environment में जो ID डालेंगे उसका नाम
// param: affiliate पैरामीटर का नाम (अपने affiliate प्रोग्राम के हिसाब से बदलें)
const STORES = {
  // ---------- RETAIL ----------
  amazon:   { type: 'q', base: 'https://www.amazon.in/s?k=', env: 'AMAZON_AFF_ID', param: 'tag' },
  flipkart: { type: 'q', base: 'https://www.flipkart.com/search?q=', env: 'FLIPKART_AFF_ID', param: 'affid' },
  meesho:   { type: 'q', base: 'https://www.meesho.com/search?q=', env: 'MEESHO_AFF_ID', param: 'utm_source' },
  myntra:   { type: 'path', base: 'https://www.myntra.com/', hyphen: true, env: 'MYNTRA_AFF_ID', param: 'utm_source' },
  ajio:     { type: 'q', base: 'https://www.ajio.com/search/?text=', env: 'AJIO_AFF_ID', param: 'utm_source' },
  tatacliq: { type: 'q', base: 'https://www.tatacliq.com/search/?searchCategory=all&text=', env: 'TATACLIQ_AFF_ID', param: 'utm_source' },
  jiomart:  { type: 'path', base: 'https://www.jiomart.com/search/', env: 'JIOMART_AFF_ID', param: 'utm_source' },
  shopclues:{ type: 'google', label: 'ShopClues' },

  // ---------- QUICK COMMERCE & GROCERY ----------
  blinkit:   { type: 'q', base: 'https://blinkit.com/s/?q=', env: 'BLINKIT_AFF_ID', param: 'utm_source' },
  zepto:     { type: 'q', base: 'https://www.zeptonow.com/search?query=', env: 'ZEPTO_AFF_ID', param: 'utm_source' },
  instamart: { type: 'q', base: 'https://www.swiggy.com/instamart/search?custom_back=true&query=', env: 'INSTAMART_AFF_ID', param: 'utm_source' },
  bigbasket: { type: 'q', base: 'https://www.bigbasket.com/ps/?q=', env: 'BIGBASKET_AFF_ID', param: 'utm_source' },

  // ---------- WHOLESALE / B2B ----------
  indiamart:         { type: 'q', base: 'https://dir.indiamart.com/search.mp?ss=', env: 'INDIAMART_AFF_ID', param: 'utm_source' },
  udaan:             { type: 'q', base: 'https://www.udaan.com/search?q=', env: 'UDAAN_AFF_ID', param: 'utm_source' },
  tradeindia:        { type: 'q', base: 'https://www.tradeindia.com/search.html?keyword=', env: 'TRADEINDIA_AFF_ID', param: 'utm_source' },
  flipkartwholesale: { type: 'q', base: 'https://www.flipkart.com/search?q=', env: 'FLIPKART_AFF_ID', param: 'affid' },
  jumbotail:         { type: 'q', base: 'https://jumbotail.com/search?q=', env: 'JUMBOTAIL_AFF_ID', param: 'utm_source' },
  ninjacart:         { type: 'q', base: 'https://ninjacart.in/search?q=', env: 'NINJACART_AFF_ID', param: 'utm_source' },

  // ---------- COMMERCIAL / INDUSTRIAL ----------
  amazonbusiness: { type: 'q', base: 'https://www.amazon.in/s?k=', env: 'AMAZON_AFF_ID', param: 'tag' },
  moglix:         { type: 'q', base: 'https://www.moglix.com/search?q=', env: 'MOGLIX_AFF_ID', param: 'utm_source' },
  industrybuying: { type: 'q', base: 'https://www.industrybuying.com/search/?q=', env: 'INDUSTRYBUYING_AFF_ID', param: 'utm_source' },

  // ---------- GLOBAL ----------
  alibaba: { type: 'q', base: 'https://www.alibaba.com/trade/search?SearchText=', env: 'ALIBABA_AFF_ID', param: 'aff_id' },

  // ---------- RESELLING ----------
  glowroad: { type: 'google', label: 'GlowRoad' },
  shop101:  { type: 'google', label: 'Shop101' },
  navo:     { type: 'q', base: 'https://navo.app/search?q=', env: 'NAVO_AFF_ID', param: 'utm_source' }
};

// ==================== HELPERS ====================
function googleLink(query, label) {
  return `https://www.google.com/search?q=${encodeURIComponent((query + ' ' + (label || '') + ' buy online').trim())}`;
}

// affiliate ID सिर्फ तब जुड़ेगी जब Render में असली ID डाली हो
function withAffiliate(url, store) {
  const id = store.env ? process.env[store.env] : '';
  if (!id || /^YOUR_/i.test(id)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${store.param}=${encodeURIComponent(id)}`;
}

function buildAffiliateLink(storeKey, query, storeName) {
  const key = String(storeKey || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const store = STORES[key];
  if (!store) return googleLink(query, storeName);
  if (store.type === 'google') return googleLink(query, store.label);

  let url;
  if (store.type === 'path') {
    const slug = store.hyphen
      ? encodeURIComponent(query.trim().replace(/\s+/g, '-'))
      : encodeURIComponent(query.trim());
    url = store.base + slug;
  } else {
    url = store.base + encodeURIComponent(query.trim());
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

function priceToNumber(price) {
  const n = parseInt(String(price).replace(/[^\d]/g, ''), 10);
  return Number.isNaN(n) ? Infinity : n;
}

// ==================== GEMINI ====================
const GEMINI_KEY = process.env.GEMINI_API_KEY;
let ai = null;
if (GEMINI_KEY && GEMINI_KEY !== 'YOUR_GEMINI_API_KEY') {
  try {
    ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
  } catch (e) {
    console.error('Gemini init failed:', e.message);
  }
} else {
  console.warn('⚠️  GEMINI_API_KEY not set — fallback results will be used.');
}

function buildPrompt(query) {
  return `You are an expert e-commerce, wholesale, B2B, quick-commerce, and reselling price comparison engine for India.

The user is searching for: "${query}".

Provide 3-5 matching products with realistic price comparisons across these platforms based on the item category:

RETAIL & FASHION: Amazon, Flipkart, JioMart, Meesho, Myntra, Ajio, TataCLiQ
QUICK COMMERCE & GROCERY: Blinkit, Zepto, Instamart, BigBasket
WHOLESALE / B2B: IndiaMART, Udaan, TradeIndia, Flipkart Wholesale, Jumbotail, NinjaCart
COMMERCIAL / INDUSTRIAL: Amazon Business, Moglix, IndustryBuying
GLOBAL / IMPORT: Alibaba
RESELLING & SOCIAL: GlowRoad, Shop101, Navo

STRICT OUTPUT FORMAT — Return ONLY a raw JSON array (no markdown, no code fences, no explanations):

[
  {
    "category": "retail" | "wholesale" | "grocery" | "reselling" | "commercial" | "global",
    "title": "Exact Product Full Name",
    "image": "",
    "badgeText": "Retail / Consumer" | "Wholesale / B2B" | "Grocery & Quick" | "Reselling & Social" | "Commercial / Industrial" | "Global / Import",
    "storeKeys": ["amazon", "flipkart"],
    "stores": [
      {"name": "Amazon", "price": "₹11,499", "isLowest": false},
      {"name": "Flipkart", "price": "₹10,999", "isLowest": true}
    ]
  }
]

IMPORTANT RULES:
1. "storeKeys" MUST be lowercase keys from this exact list: amazon, flipkart, meesho, myntra, ajio, tatacliq, jiomart, blinkit, zepto, instamart, bigbasket, indiamart, udaan, tradeindia, flipkartwholesale, jumbotail, ninjacart, amazonbusiness, moglix, industrybuying, alibaba, glowroad, shop101, navo
2. "stores" array length MUST exactly match "storeKeys" array length, in the same order.
3. Exactly ONE store must have "isLowest": true per product.
4. Prices must be realistic Indian Rupee values (₹) with comma formatting.
5. Return 3-5 product objects.
6. Leave "image" as an empty string. Do NOT include the "link" field — links are generated by the server.`;
}

function getFallbackResults(query) {
  return [
    {
      category: 'retail', title: `${query} — Retail Pick`, image: '', badgeText: 'Retail / Consumer',
      storeKeys: ['amazon', 'flipkart'],
      stores: [
        { name: 'Amazon', price: '₹1,499', isLowest: false },
        { name: 'Flipkart', price: '₹1,299', isLowest: true }
      ]
    },
    {
      category: 'wholesale', title: `${query} — Wholesale Pack`, image: '', badgeText: 'Wholesale / B2B',
      storeKeys: ['indiamart', 'udaan'],
      stores: [
        { name: 'IndiaMART', price: '₹850 / pc', isLowest: true },
        { name: 'Udaan', price: '₹950 / pc', isLowest: false }
      ]
    },
    {
      category: 'reselling', title: `${query} — Reseller Deal`, image: '', badgeText: 'Reselling & Social',
      storeKeys: ['meesho', 'navo'],
      stores: [
        { name: 'Meesho', price: '₹349', isLowest: true },
        { name: 'Navo', price: '₹375', isLowest: false }
      ]
    }
  ];
}

function safeParseAIResponse(text) {
  if (!text) return null;
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.substring(start, end + 1));
  } catch (e) {
    console.error('JSON parse failed:', e.message);
    return null;
  }
}

// ==================== SEARCH API ====================
app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || !String(query).trim()) {
      return res.status(400).json({ success: false, error: 'Search query required' });
    }
    const cleanQuery = String(query).trim().toLowerCase().slice(0, 100);

    const cachedData = searchCache.get(cleanQuery);
    if (cachedData) {
      if (Date.now() - cachedData.timestamp < CACHE_EXPIRY_MS) {
        return res.json({ success: true, products: cachedData.products, fromCache: true });
      }
      searchCache.delete(cleanQuery);
    }

    let products = null;
    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: buildPrompt(cleanQuery),
          config: { responseMimeType: 'application/json' }
        });
        products = safeParseAIResponse(response.text);
      } catch (aiErr) {
        console.error('AI error:', aiErr.message);
      }
    }

    let usedFallback = false;
    if (!Array.isArray(products) || products.length === 0) {
      products = getFallbackResults(cleanQuery);
      usedFallback = true;
    }

    const finalProducts = products
      .filter(item => item && typeof item === 'object')
      .map(item => {
        const storeKeys = Array.isArray(item.storeKeys) ? item.storeKeys : [];
        const stores = (Array.isArray(item.stores) ? item.stores : [])
          .filter(s => s && s.name)
          .map((store, idx) => {
            const keyFromAI = storeKeys[idx] || String(store.name).toLowerCase().replace(/\s+/g, '');
            return {
              name: String(store.name),
              price: String(store.price || '—'),
              isLowest: !!store.isLowest,
              link: buildAffiliateLink(keyFromAI, cleanQuery, store.name)
            };
          });

        if (stores.length > 0) {
          const flagged = stores.filter(s => s.isLowest).length;
          if (flagged !== 1) {
            let minIdx = 0;
            stores.forEach((s, i) => {
              if (priceToNumber(s.price) < priceToNumber(stores[minIdx].price)) minIdx = i;
            });
            stores.forEach((s, i) => { s.isLowest = i === minIdx; });
          }
        }

        const title = item.title ? String(item.title) : cleanQuery;
        const aiImage = typeof item.image === 'string' ? item.image : '';
        const image =
          aiImage.startsWith('https://') && !aiImage.includes('placeholder.com')
            ? aiImage
            : placeholderImage(title);

        return {
          category: item.category || 'retail',
          title,
          image,
          badgeText: item.badgeText || 'Retail',
          stores
        };
      })
      .filter(item => item.stores.length > 0);

    if (!usedFallback && finalProducts.length > 0) {
      searchCache.set(cleanQuery, { products: finalProducts, timestamp: Date.now() });
    }

    return res.json({ success: true, products: finalProducts });
  } catch (err) {
    console.error('Search endpoint error:', err);
    return res.status(500).json({ success: false, error: 'Server error. Please retry.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ai: !!ai, model: GEMINI_MODEL, cachedItems: searchCache.size, timestamp: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🛒 Shopping Deals Server running on port ${PORT}`);
  console.log(`🤖 Gemini AI: ${ai ? '✅ Active (' + GEMINI_MODEL + ')' : '⚠️  Fallback mode'}`);
});
