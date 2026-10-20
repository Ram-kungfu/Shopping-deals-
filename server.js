require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== CACHE ====================
const searchCache = new Map();
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 Hours

// ==================== AFFILIATE LINK CONFIG ====================
const AFFILIATE_CONFIG = {
  // ---------- RETAIL ----------
  amazon: { base: 'https://www.amazon.in/s?k=', param: '&tag=' + (process.env.AMAZON_AFF_ID || 'YOUR_AMAZON_ID') },
  flipkart: { base: 'https://www.flipkart.com/search?q=', param: '&affid=' + (process.env.FLIPKART_AFF_ID || 'YOUR_FLIPKART_ID') },
  meesho: { base: 'https://www.meesho.com/search?q=', param: '&utm_source=' + (process.env.MEESHO_AFF_ID || 'YOUR_MEESHO_ID') },
  myntra: { base: 'https://www.myntra.com/', param: '?utm_source=' + (process.env.MYNTRA_AFF_ID || 'YOUR_MYNTRA_ID') },
  ajio: { base: 'https://www.ajio.com/search/?text=', param: '&utm_source=' + (process.env.AJIO_AFF_ID || 'YOUR_AJIO_ID') },
  tatacliq: { base: 'https://www.tatacliq.com/search/?searchCategory=all&text=', param: '&utm_source=' + (process.env.TATACLIQ_AFF_ID || 'YOUR_TATACLIQ_ID') },
  jiomart: { base: 'https://www.jiomart.com/search/', param: '?utm_source=' + (process.env.JIOMART_AFF_ID || 'YOUR_JIOMART_ID') },
  shopclues: { base: 'https://www.shopclues.com/search?q=', param: '&utm_source=' + (process.env.SHOPCLUES_AFF_ID || 'YOUR_SHOPCLUES_ID') },

  // ---------- QUICK COMMERCE & GROCERY ----------
  blinkit: { base: 'https://blinkit.com/s/?q=', param: '&utm_source=' + (process.env.BLINKIT_AFF_ID || 'YOUR_BLINKIT_ID') },
  zepto: { base: 'https://www.zeptonow.com/search?query=', param: '&utm_source=' + (process.env.ZEPTO_AFF_ID || 'YOUR_ZEPTO_ID') },
  instamart: { base: 'https://www.swiggy.com/instamart/search?custom_back=true&query=', param: '&utm_source=' + (process.env.INSTAMART_AFF_ID || 'YOUR_INSTAMART_ID') },
  bigbasket: { base: 'https://www.bigbasket.com/ps/?q=', param: '&utm_source=' + (process.env.BIGBASKET_AFF_ID || 'YOUR_BIGBASKET_ID') },

  // ---------- WHOLESALE / B2B ----------
  indiamart: { base: 'https://dir.indiamart.com/search.mp?ss=', param: '&utm_source=' + (process.env.INDIAMART_AFF_ID || 'YOUR_INDIAMART_ID') },
  udaan: { base: 'https://www.udaan.com/search?q=', param: '&utm_source=' + (process.env.UDAAN_AFF_ID || 'YOUR_UDAAN_ID') },
  tradeindia: { base: 'https://www.tradeindia.com/search.html?keyword=', param: '&utm_source=' + (process.env.TRADEINDIA_AFF_ID || 'YOUR_TRADEINDIA_ID') },
  flipkartwholesale: { base: 'https://www.flipkart.com/search?q=', param: '&affid=' + (process.env.FLIPKART_AFF_ID || 'YOUR_FLIPKART_ID') + '&wholesale=true' },
  jumbotail: { base: 'https://jumbotail.com/search?q=', param: '&utm_source=' + (process.env.JUMBOTAIL_AFF_ID || 'YOUR_JUMBOTAIL_ID') },
  ninjacart: { base: 'https://ninjacart.in/search?q=', param: '&utm_source=' + (process.env.NINJACART_AFF_ID || 'YOUR_NINJACART_ID') },

  // ---------- COMMERCIAL / INDUSTRIAL ----------
  amazonbusiness: { base: 'https://www.amazon.in/s?k=', param: '&tag=' + (process.env.AMAZON_AFF_ID || 'YOUR_AMAZON_ID') + '&i=b2b' },
  moglix: { base: 'https://www.moglix.com/search?q=', param: '&utm_source=' + (process.env.MOGLIX_AFF_ID || 'YOUR_MOGLIX_ID') },
  industrybuying: { base: 'https://www.industrybuying.com/search/?q=', param: '&utm_source=' + (process.env.INDUSTRYBUYING_AFF_ID || 'YOUR_IB_ID') },

  // ---------- GLOBAL / IMPORT ----------
  alibaba: { base: 'https://www.alibaba.com/trade/search?SearchText=', param: '&aff_id=' + (process.env.ALIBABA_AFF_ID || 'YOUR_ALIBABA_ID') },

  // ---------- RESELLING ----------
  glowroad: { base: 'https://www.glowroad.com/search?q=', param: '&affid=' + (process.env.GLOWROAD_AFF_ID || 'YOUR_GLOWROAD_ID') },
  shop101: { base: 'https://www.shop101.com/search?q=', param: '&affid=' + (process.env.SHOP101_AFF_ID || 'YOUR_SHOP101_ID') },
  navo: { base: 'https://navo.app/search?q=', param: '&affid=' + (process.env.NAVO_AFF_ID || 'YOUR_NAVO_ID') }
};

// ==================== HELPERS ====================
function buildAffiliateLink(storeKey, query) {
  const key = String(storeKey || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const store = AFFILIATE_CONFIG[key];
  if (!store) {
    return `https://www.google.com/search?q=${encodeURIComponent(query + ' buy online')}`;
  }
  return `${store.base}${encodeURIComponent(query)}${store.param}`;
}

// इमेज खुद बनाएं (via.placeholder.com बंद हो चुका है)
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

// ==================== GEMINI AI INIT ====================
const GEMINI_KEY = process.env.GEMINI_API_KEY;
let ai = null;
if (GEMINI_KEY && GEMINI_KEY !== 'YOUR_GEMINI_API_KEY') {
  try {
    ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
  } catch (e) {
    console.error('Gemini init failed:', e.message);
  }
} else {
  console.warn('⚠️  GEMINI_API_KEY not set — AI search will use fallback static results.');
}

// ==================== PROMPT BUILDER ====================
function buildPrompt(query) {
  return `You are an expert e-commerce, wholesale, B2B, quick-commerce, and reselling price comparison engine for India.

The user is searching for: "${query}".

Provide 3-5 matching products with realistic price comparisons across these platforms based on the item category:

RETAIL & FASHION: Amazon, Flipkart, JioMart, ShopClues, Meesho, Myntra, Ajio, TataCLiQ
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
1. "storeKeys" MUST be lowercase keys from this exact list: amazon, flipkart, meesho, myntra, ajio, tatacliq, jiomart, shopclues, blinkit, zepto, instamart, bigbasket, indiamart, udaan, tradeindia, flipkartwholesale, jumbotail, ninjacart, amazonbusiness, moglix, industrybuying, alibaba, glowroad, shop101, navo
2. "stores" array length MUST exactly match "storeKeys" array length, in the same order.
3. Exactly ONE store must have "isLowest": true per product.
4. Prices must be realistic Indian Rupee values (₹) with comma formatting.
5. Return 3-5 product objects.
6. Leave "image" as an empty string. Do NOT include the "link" field — links are generated by the server.`;
}

// ==================== FALLBACK STATIC DATA ====================
function getFallbackResults(query) {
  return [
    {
      category: 'retail',
      title: `${query} — Retail Pick`,
      image: '',
      badgeText: 'Retail / Consumer',
      storeKeys: ['amazon', 'flipkart'],
      stores: [
        { name: 'Amazon', price: '₹1,499', isLowest: false },
        { name: 'Flipkart', price: '₹1,299', isLowest: true }
      ]
    },
    {
      category: 'wholesale',
      title: `${query} — Wholesale Pack`,
      image: '',
      badgeText: 'Wholesale / B2B',
      storeKeys: ['indiamart', 'udaan'],
      stores: [
        { name: 'IndiaMART', price: '₹850 / pc', isLowest: true },
        { name: 'Udaan', price: '₹950 / pc', isLowest: false }
      ]
    },
    {
      category: 'reselling',
      title: `${query} — Reseller Deal`,
      image: '',
      badgeText: 'Reselling & Social',
      storeKeys: ['glowroad', 'shop101', 'navo'],
      stores: [
        { name: 'GlowRoad', price: '₹349', isLowest: true },
        { name: 'Shop101', price: '₹399', isLowest: false },
        { name: 'Navo', price: '₹375', isLowest: false }
      ]
    }
  ];
}

// ==================== SAFE JSON PARSE ====================
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

    // 1. CACHE
    const cachedData = searchCache.get(cleanQuery);
    if (cachedData) {
      if (Date.now() - cachedData.timestamp < CACHE_EXPIRY_MS) {
        console.log(`✅ Cache Hit: "${cleanQuery}"`);
        return res.json({ success: true, products: cachedData.products, fromCache: true });
      }
      searchCache.delete(cleanQuery);
    }

    console.log(`⏳ Cache Miss: "${cleanQuery}" (AI कॉल हो रही है...)`);

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

    // 2. AFFILIATE LINKS
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
              link: buildAffiliateLink(keyFromAI, cleanQuery)
            };
          });

        // सिर्फ एक "सस्ता" रखें
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

    // 3. CACHE में सेव (fallback डेटा सेव नहीं करते, ताकि बाद में असली AI रेट मिले)
    if (!usedFallback && finalProducts.length > 0) {
      searchCache.set(cleanQuery, { products: finalProducts, timestamp: Date.now() });
    }

    return res.json({ success: true, products: finalProducts });
  } catch (err) {
    console.error('Search endpoint error:', err);
    return res.status(500).json({ success: false, error: 'Server error. Please retry.' });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ai: !!ai, model: GEMINI_MODEL, cachedItems: searchCache.size, timestamp: new Date().toISOString() });
});

// ==================== CATCH-ALL → index.html ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`\n🛒 Shopping Deals Server running on port ${PORT}`);
  console.log(`🤖 Gemini AI: ${ai ? '✅ Active (' + GEMINI_MODEL + ')' : '⚠️  Fallback mode (no API key)'}`);
  console.log(`⚡ Caching: ✅ Active (24 Hours)\n`);
});
