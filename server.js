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
const STORES = {
  // ---------- RETAIL (8 Stores) ----------
  amazon:   { type: 'q', base: 'https://www.amazon.in/s?k=', env: 'AMAZON_AFF_ID', param: 'tag', name: 'Amazon' },
  flipkart: { type: 'q', base: 'https://www.flipkart.com/search?q=', env: 'FLIPKART_AFF_ID', param: 'affid', name: 'Flipkart' },
  meesho:   { type: 'q', base: 'https://www.meesho.com/search?q=', env: 'MEESHO_AFF_ID', param: 'utm_source', name: 'Meesho' },
  myntra:   { type: 'path', base: 'https://www.myntra.com/', hyphen: true, env: 'MYNTRA_AFF_ID', param: 'utm_source', name: 'Myntra' },
  ajio:     { type: 'q', base: 'https://www.ajio.com/search/?text=', env: 'AJIO_AFF_ID', param: 'utm_source', name: 'Ajio' },
  tatacliq: { type: 'q', base: 'https://www.tatacliq.com/search/?searchCategory=all&text=', env: 'TATACLIQ_AFF_ID', param: 'utm_source', name: 'TataCLiQ' },
  jiomart:  { type: 'path', base: 'https://www.jiomart.com/search/', env: 'JIOMART_AFF_ID', param: 'utm_source', name: 'JioMart' },
  shopclues:{ type: 'google', label: 'ShopClues', name: 'ShopClues' },

  // ---------- QUICK COMMERCE & GROCERY (4 Stores) ----------
  blinkit:   { type: 'q', base: 'https://blinkit.com/s/?q=', env: 'BLINKIT_AFF_ID', param: 'utm_source', name: 'Blinkit' },
  zepto:     { type: 'q', base: 'https://www.zeptonow.com/search?query=', env: 'ZEPTO_AFF_ID', param: 'utm_source', name: 'Zepto' },
  instamart: { type: 'q', base: 'https://www.swiggy.com/instamart/search?custom_back=true&query=', env: 'INSTAMART_AFF_ID', param: 'utm_source', name: 'Instamart' },
  bigbasket: { type: 'q', base: 'https://www.bigbasket.com/ps/?q=', env: 'BIGBASKET_AFF_ID', param: 'utm_source', name: 'BigBasket' },

  // ---------- WHOLESALE / B2B (6 Stores) ----------
  indiamart:         { type: 'q', base: 'https://dir.indiamart.com/search.mp?ss=', env: 'INDIAMART_AFF_ID', param: 'utm_source', name: 'IndiaMART' },
  udaan:             { type: 'q', base: 'https://www.udaan.com/search?q=', env: 'UDAAN_AFF_ID', param: 'utm_source', name: 'Udaan' },
  tradeindia:        { type: 'q', base: 'https://www.tradeindia.com/search.html?keyword=', env: 'TRADEINDIA_AFF_ID', param: 'utm_source', name: 'TradeIndia' },
  flipkartwholesale: { type: 'q', base: 'https://www.flipkart.com/search?q=', env: 'FLIPKART_AFF_ID', param: 'affid', name: 'Flipkart Wholesale' },
  jumbotail:         { type: 'q', base: 'https://jumbotail.com/search?q=', env: 'JUMBOTAIL_AFF_ID', param: 'utm_source', name: 'Jumbotail' },
  ninjacart:         { type: 'q', base: 'https://ninjacart.in/search?q=', env: 'NINJACART_AFF_ID', param: 'utm_source', name: 'NinjaCart' },

  // ---------- COMMERCIAL / INDUSTRIAL (3 Stores) ----------
  amazonbusiness: { type: 'q', base: 'https://www.amazon.in/s?k=', env: 'AMAZON_AFF_ID', param: 'tag', name: 'Amazon Business' },
  moglix:         { type: 'q', base: 'https://www.moglix.com/search?q=', env: 'MOGLIX_AFF_ID', param: 'utm_source', name: 'Moglix' },
  industrybuying: { type: 'q', base: 'https://www.industrybuying.com/search/?q=', env: 'INDUSTRYBUYING_AFF_ID', param: 'utm_source', name: 'IndustryBuying' },

  // ---------- GLOBAL (1 Store) ----------
  alibaba: { type: 'q', base: 'https://www.alibaba.com/trade/search?SearchText=', env: 'ALIBABA_AFF_ID', param: 'aff_id', name: 'Alibaba' },

  // ---------- RESELLING (3 Stores) ----------
  glowroad: { type: 'google', label: 'GlowRoad', name: 'GlowRoad' },
  shop101:  { type: 'google', label: 'Shop101', name: 'Shop101' },
  navo:     { type: 'q', base: 'https://navo.app/search?q=', env: 'NAVO_AFF_ID', param: 'utm_source', name: 'Navo' }
};

// ==================== HELPERS ====================
function googleLink(query, label) {
  return `https://www.google.com/search?q=${encodeURIComponent((query + ' ' + (label || '') + ' buy online').trim())}`;
}

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

// 🔴 प्रॉम्प्ट को और सख्त कर दिया गया है ताकि AI असली रेंज में कीमत दे
function buildPrompt(query) {
  return `You are an expert e-commerce, wholesale, B2B, quick-commerce, and reselling price comparison engine for India.

The user is searching for: "${query}".

YOUR STRICT TASK:
You MUST generate an array containing AT LEAST 6 distinct product objects. 
One product MUST belong to each of these 6 categories:
1. "retail" (e.g., Amazon, Flipkart, Myntra, Ajio)
2. "wholesale" (e.g., IndiaMART, Udaan, TradeIndia)
3. "reselling" (e.g., Meesho, GlowRoad, Shop101)
4. "grocery" (e.g., Blinkit, Zepto, BigBasket)
5. "commercial" (e.g., Moglix, IndustryBuying)
6. "global" (e.g., Alibaba)

🚨 CRITICAL RULE FOR STORES: 
You must include AS MANY STORES AS POSSIBLE for each product. 
For the "retail" category, include at least 4 to 6 stores.
For "wholesale", include at least 3 to 5 stores.
Do NOT limit the options.

STRICT OUTPUT FORMAT — Return ONLY a raw JSON array (no markdown, no code fences, no explanations):

[
  {
    "category": "retail",
    "title": "Exact Product Full Name",
    "image": "",
    "badgeText": "Retail / Consumer",
    "storeKeys": ["amazon", "flipkart", "myntra", "ajio"],
    "stores": [
      {"name": "Amazon", "price": "₹11,499", "isLowest": false},
      {"name": "Flipkart", "price": "₹10,999", "isLowest": true},
      {"name": "Myntra", "price": "₹11,999", "isLowest": false},
      {"name": "Ajio", "price": "₹11,200", "isLowest": false}
    ]
  }
]

IMPORTANT RULES:
1. "storeKeys" MUST be lowercase keys from this exact list: amazon, flipkart, meesho, myntra, ajio, tatacliq, jiomart, blinkit, zepto, instamart, bigbasket, indiamart, udaan, tradeindia, flipkartwholesale, jumbotail, ninjacart, amazonbusiness, moglix, industrybuying, alibaba, glowroad, shop101, navo
2. "stores" array length MUST exactly match "storeKeys" array length, in the same order.
3. Exactly ONE store must have "isLowest": true per product.
4. Prices must be realistic Indian Rupee values (₹) with comma formatting. For example, a Samsung F14 5G should be around ₹11,000-₹15,000. Do NOT give fake low prices like ₹500.
5. Leave "image" as an empty string. Do NOT include the "link" field — links are generated by the server.`;
}

function getFallbackResults(query) {
  return [
    {
      category: 'retail', title: `${query} — Retail Pick`, image: '', badgeText: 'Retail / Consumer',
      storeKeys: ['amazon', 'flipkart', 'myntra', 'ajio', 'tatacliq', 'jiomart', 'meesho', 'shopclues'],
      stores: [
        { name: 'Amazon', price: '₹1,499', isLowest: false },
        { name: 'Flipkart', price: '₹1,299', isLowest: true },
        { name: 'Myntra', price: '₹1,599', isLowest: false },
        { name: 'Ajio', price: '₹1,399', isLowest: false },
        { name: 'TataCLiQ', price: '₹1,450', isLowest: false },
        { name: 'JioMart', price: '₹1,350', isLowest: false },
        { name: 'Meesho', price: '₹1,199', isLowest: false },
        { name: 'ShopClues', price: '₹1,250', isLowest: false }
      ]
    },
    {
      category: 'wholesale', title: `${query} — Wholesale Pack`, image: '', badgeText: 'Wholesale / B2B',
      storeKeys: ['indiamart', 'udaan', 'tradeindia', 'flipkartwholesale', 'jumbotail', 'ninjacart'],
      stores: [
        { name: 'IndiaMART', price: '₹850 / pc', isLowest: true },
        { name: 'Udaan', price: '₹950 / pc', isLowest: false },
        { name: 'TradeIndia', price: '₹900 / pc', isLowest: false },
        { name: 'Flipkart Wholesale', price: '₹880 / pc', isLowest: false },
        { name: 'Jumbotail', price: '₹920 / pc', isLowest: false },
        { name: 'NinjaCart', price: '₹890 / pc', isLowest: false }
      ]
    },
    {
      category: 'reselling', title: `${query} — Reseller Deal`, image: '', badgeText: 'Reselling & Social',
      storeKeys: ['meesho', 'navo', 'glowroad', 'shop101'],
      stores: [
        { name: 'Meesho', price: '₹349', isLowest: true },
        { name: 'Navo', price: '₹375', isLowest: false },
        { name: 'GlowRoad', price: '₹399', isLowest: false },
        { name: 'Shop101', price: '₹380', isLowest: false }
      ]
    },
    {
      category: 'grocery', title: `${query} — Grocery Quick Pick`, image: '', badgeText: 'Grocery & Quick',
      storeKeys: ['blinkit', 'zepto', 'instamart', 'bigbasket'],
      stores: [
        { name: 'Blinkit', price: '₹120', isLowest: true },
        { name: 'Zepto', price: '₹135', isLowest: false },
        { name: 'Instamart', price: '₹125', isLowest: false },
        { name: 'BigBasket', price: '₹110', isLowest: false }
      ]
    },
    {
      category: 'commercial', title: `${query} — Industrial Grade`, image: '', badgeText: 'Commercial / Industrial',
      storeKeys: ['moglix', 'industrybuying', 'amazonbusiness'],
      stores: [
        { name: 'Moglix', price: '₹4,500', isLowest: true },
        { name: 'IndustryBuying', price: '₹4,800', isLowest: false },
        { name: 'Amazon Business', price: '₹4,600', isLowest: false }
      ]
    },
    {
      category: 'global', title: `${query} — Import Quality`, image: '', badgeText: 'Global / Import',
      storeKeys: ['alibaba'],
      stores: [
        { name: 'Alibaba', price: '₹500 / pc', isLowest: true }
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
    } else {
      const existingCats = products.map(p => p.category);
      const fallbackData = getFallbackResults(cleanQuery);
      
      fallbackData.forEach(fbItem => {
        if (!existingCats.includes(fbItem.category)) {
          products.push(fbItem);
        }
      });
    }

    let finalProducts = products
      .filter(item => item && typeof item === 'object')
      .map(item => {
        let storeKeys = Array.isArray(item.storeKeys) ? item.storeKeys : [];
        let stores = (Array.isArray(item.stores) ? item.stores : [])
          .filter(s => s && s.name)
          .map((store, idx) => {
            const keyFromAI = storeKeys[idx] || String(store.name).toLowerCase().replace(/\s+/g, '');
            return {
              name: String(store.name),
              price: String(store.price || '—'),
              isLowest: false, 
              key: keyFromAI,
              link: buildAffiliateLink(keyFromAI, cleanQuery, store.name),
              altLink: (keyFromAI === 'meesho' || keyFromAI === 'udaan') ? googleLink(cleanQuery, store.name) : null 
            };
          });

        const categoryStoresMap = {
          retail: ['amazon', 'flipkart', 'myntra', 'ajio', 'tatacliq', 'jiomart', 'meesho', 'shopclues'],
          wholesale: ['indiamart', 'udaan', 'tradeindia', 'flipkartwholesale', 'jumbotail', 'ninjacart'],
          reselling: ['meesho', 'navo', 'glowroad', 'shop101'],
          grocery: ['blinkit', 'zepto', 'instamart', 'bigbasket'],
          commercial: ['moglix', 'industrybuying', 'amazonbusiness'],
          global: ['alibaba']
        };

        const requiredStores = categoryStoresMap[item.category] || [];
        const existingKeys = stores.map(s => s.key);

        requiredStores.forEach(reqKey => {
          if (!existingKeys.includes(reqKey)) {
            const storeConfig = STORES[reqKey];
            if (storeConfig) {
              stores.push({
                name: storeConfig.name,
                price: '', 
                isLowest: false,
                key: reqKey,
                link: buildAffiliateLink(reqKey, cleanQuery, storeConfig.name),
                altLink: (reqKey === 'meesho' || reqKey === 'udaan') ? googleLink(cleanQuery, storeConfig.name) : null
              });
            }
          }
        });

        return {
          category: item.category || 'retail',
          title: item.title ? String(item.title) : cleanQuery,
          image: '', 
          badgeText: item.badgeText || 'Retail',
          stores
        };
      })
      .filter(item => item.stores.length > 0);

    // 🔴 स्मार्ट प्राइस एडजस्टर (Serper हटा दिया गया है, सिर्फ AI की कीमतों पर भरोसा)
    finalProducts = finalProducts.map(p => {
      if (p.stores.length > 0) {
        let minPrice = Infinity;
        p.stores.forEach(s => {
          if (s.price && s.price !== '—' && s.price !== '') {
            const num = priceToNumber(s.price);
            if (num < minPrice && num > 0) minPrice = num;
          }
        });

        if (minPrice !== Infinity) {
          p.stores.forEach(s => {
            if (s.price && s.price !== '—' && s.price !== '') {
              const num = priceToNumber(s.price);
              // अगर कीमत 40% से ज्यादा है, तो कम करें
              if (num > minPrice * 1.4) {
                const newPrice = Math.round(minPrice * (1 + (Math.random() * 0.15 + 0.05))); 
                s.price = '₹' + newPrice;
              }
            } else {
              s.price = '₹' + Math.round(minPrice * (1 + (Math.random() * 0.3 + 0.1)));
            }
          });
        }

        let minPriceIndex = -1;
        let minPriceValue = Infinity;
        p.stores.forEach((s, i) => {
          const num = priceToNumber(s.price);
          if (num < minPriceValue) {
            minPriceValue = num;
            minPriceIndex = i;
          }
        });

        p.stores.forEach((s, i) => { s.isLowest = (i === minPriceIndex); });
      }

      if (!p.image || p.image === '') {
        p.image = placeholderImage(p.title);
      }
      return p;
    });

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
