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
  amazon:   { type: 'q', base: 'https://www.amazon.in/s?k=', env: 'AMAZON_AFF_ID', param: 'tag', name: 'Amazon' },
  flipkart: { type: 'q', base: 'https://www.flipkart.com/search?q=', env: 'FLIPKART_AFF_ID', param: 'affid', name: 'Flipkart' },
  meesho:   { type: 'q', base: 'https://www.meesho.com/search?q=', env: 'MEESHO_AFF_ID', param: 'utm_source', name: 'Meesho' },
  myntra:   { type: 'path', base: 'https://www.myntra.com/', hyphen: true, env: 'MYNTRA_AFF_ID', param: 'utm_source', name: 'Myntra' },
  ajio:     { type: 'q', base: 'https://www.ajio.com/search/?text=', env: 'AJIO_AFF_ID', param: 'utm_source', name: 'Ajio' },
  tatacliq: { type: 'q', base: 'https://www.tatacliq.com/search/?searchCategory=all&text=', env: 'TATACLIQ_AFF_ID', param: 'utm_source', name: 'TataCLiQ' },
  jiomart:  { type: 'path', base: 'https://www.jiomart.com/search/', env: 'JIOMART_AFF_ID', param: 'utm_source', name: 'JioMart' },
  shopclues:{ type: 'google', label: 'ShopClues', name: 'ShopClues' },
  blinkit:  { type: 'q', base: 'https://blinkit.com/s/?q=', env: 'BLINKIT_AFF_ID', param: 'utm_source', name: 'Blinkit' },
  zepto:    { type: 'q', base: 'https://www.zeptonow.com/search?query=', env: 'ZEPTO_AFF_ID', param: 'utm_source', name: 'Zepto' },
  instamart:{ type: 'q', base: 'https://www.swiggy.com/instamart/search?custom_back=true&query=', env: 'INSTAMART_AFF_ID', param: 'utm_source', name: 'Instamart' },
  bigbasket:{ type: 'q', base: 'https://www.bigbasket.com/ps/?q=', env: 'BIGBASKET_AFF_ID', param: 'utm_source', name: 'BigBasket' },
  indiamart:{ type: 'q', base: 'https://dir.indiamart.com/search.mp?ss=', env: 'INDIAMART_AFF_ID', param: 'utm_source', name: 'IndiaMART' },
  udaan:    { type: 'q', base: 'https://www.udaan.com/search?q=', env: 'UDAAN_AFF_ID', param: 'utm_source', name: 'Udaan' },
  tradeindia:{ type: 'q', base: 'https://www.tradeindia.com/search.html?keyword=', env: 'TRADEINDIA_AFF_ID', param: 'utm_source', name: 'TradeIndia' },
  flipkartwholesale: { type: 'q', base: 'https://www.flipkart.com/search?q=', env: 'FLIPKART_AFF_ID', param: 'affid', name: 'Flipkart Wholesale' },
  jumbotail:{ type: 'q', base: 'https://jumbotail.com/search?q=', env: 'JUMBOTAIL_AFF_ID', param: 'utm_source', name: 'Jumbotail' },
  ninjacart:{ type: 'q', base: 'https://ninjacart.in/search?q=', env: 'NINJACART_AFF_ID', param: 'utm_source', name: 'NinjaCart' },
  amazonbusiness: { type: 'q', base: 'https://www.amazon.in/s?k=', env: 'AMAZON_AFF_ID', param: 'tag', name: 'Amazon Business' },
  moglix:   { type: 'q', base: 'https://www.moglix.com/search?q=', env: 'MOGLIX_AFF_ID', param: 'utm_source', name: 'Moglix' },
  industrybuying: { type: 'q', base: 'https://www.industrybuying.com/search/?q=', env: 'INDUSTRYBUYING_AFF_ID', param: 'utm_source', name: 'IndustryBuying' },
  alibaba:  { type: 'q', base: 'https://www.alibaba.com/trade/search?SearchText=', env: 'ALIBABA_AFF_ID', param: 'aff_id', name: 'Alibaba' },
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

// 🔴 स्मार्ट कीवर्ड रेंज (अगर AI से कीमत न मिले, तो यह काम आएगा)
function getFallbackPriceRange(category, title) {
  const t = String(title).toLowerCase();
  
  if (category === 'retail') {
    if (t.includes('mobile') || t.includes('phone') || t.includes('5g') || t.includes('samsung') || t.includes('iphone')) return { min: 10000, max: 35000 };
    if (t.includes('laptop')) return { min: 30000, max: 80000 };
    if (t.includes('computer') || t.includes('pc') || t.includes('desktop')) return { min: 15000, max: 60000 };
    if (t.includes('tv') || t.includes('television')) return { min: 10000, max: 50000 };
    if (t.includes('fridge') || t.includes('refrigerator')) return { min: 8000, max: 40000 };
    if (t.includes('ac') || t.includes('air conditioner')) return { min: 20000, max: 60000 };
    if (t.includes('shirt') || t.includes('kurti') || t.includes('jeans') || t.includes('top')) return { min: 250, max: 3000 };
    if (t.includes('shoe') || t.includes('sneaker')) return { min: 500, max: 5000 };
    return { min: 500, max: 5000 };
  } 
  if (category === 'wholesale') return { min: 200, max: 2000 };
  if (category === 'reselling') return { min: 150, max: 800 };
  if (category === 'grocery') return { min: 50, max: 500 };
  if (category === 'commercial') return { min: 1000, max: 10000 };
  if (category === 'global') return { min: 500, max: 5000 };
  
  return { min: 250, max: 3000 };
}

// 🔴 स्टोर के हिसाब से कीमत बढ़ाने का फंक्शन (Smart Store Weightage)
function getStorePriceMultiplier(storeKey) {
  const key = String(storeKey).toLowerCase();
  
  if (key === 'meesho' || key === 'udaan' || key === 'glowroad' || key === 'shop101' || key === 'navo') {
    return 1.0; 
  }
  if (key === 'flipkart' || key === 'jiomart' || key === 'shopclues' || key === 'tatacliq') {
    return 1.15; 
  }
  if (key === 'myntra' || key === 'ajio') {
    return 1.30; 
  }
  if (key === 'amazon' || key === 'amazonbusiness') {
    return 1.45; 
  }
  return 1.15;
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

// 🔴 AI से सिर्फ टाइटल नहीं, बल्कि उसकी असली रेंज (Min और Max) भी मांगेंगे
function buildPrompt(query) {
  return `You are an expert e-commerce, wholesale, B2B, quick-commerce, and reselling price comparison engine for India.

The user is searching for: "${query}".

YOUR STRICT TASK:
You MUST generate an array containing AT LEAST 6 distinct product objects. 
One product MUST belong to each of these 6 categories:
1. "retail"
2. "wholesale"
3. "reselling"
4. "grocery"
5. "commercial"
6. "global"

For EACH product, you MUST provide a realistic price range (in Indian Rupees) based on what the product actually costs in the real world. 
For example: a smartphone should be around ₹10,000-₹30,000, a shirt should be around ₹300-₹1500, a laptop should be around ₹30,000-₹80,000.

STRICT OUTPUT FORMAT — Return ONLY a raw JSON array (no markdown, no code fences, no explanations):

[
  {
    "category": "retail",
    "title": "Exact Product Full Name",
    "minPrice": 10000,
    "maxPrice": 30000,
    "image": "",
    "badgeText": "Retail / Consumer",
    "storeKeys": ["amazon", "flipkart", "myntra", "ajio"]
  }
]

IMPORTANT RULES:
1. "storeKeys" MUST be lowercase keys from this exact list: amazon, flipkart, meesho, myntra, ajio, tatacliq, jiomart, blinkit, zepto, instamart, bigbasket, indiamart, udaan, tradeindia, flipkartwholesale, jumbotail, ninjacart, amazonbusiness, moglix, industrybuying, alibaba, glowroad, shop101, navo
2. "minPrice" and "maxPrice" MUST be realistic Indian Rupee values (₹) without the rupee symbol (just numbers).
3. Do NOT include "price" or "stores" array — we will generate them on the server side.
4. Leave "image" as an empty string.`;
}

function getFallbackResults(query) {
  return [
    { category: 'retail', title: `${query}`, minPrice: 0, maxPrice: 0, badgeText: 'Retail / Consumer', storeKeys: ['amazon', 'flipkart', 'myntra', 'ajio', 'tatacliq', 'jiomart', 'meesho', 'shopclues'] },
    { category: 'wholesale', title: `Bulk ${query}`, minPrice: 0, maxPrice: 0, badgeText: 'Wholesale / B2B', storeKeys: ['indiamart', 'udaan', 'tradeindia', 'flipkartwholesale', 'jumbotail', 'ninjacart'] },
    { category: 'reselling', title: `${query} for Resellers`, minPrice: 0, maxPrice: 0, badgeText: 'Reselling & Social', storeKeys: ['meesho', 'navo', 'glowroad', 'shop101'] },
    { category: 'grocery', title: `${query} (Quick)`, minPrice: 0, maxPrice: 0, badgeText: 'Grocery & Quick', storeKeys: ['blinkit', 'zepto', 'instamart', 'bigbasket'] },
    { category: 'commercial', title: `Bulk Order ${query}`, minPrice: 0, maxPrice: 0, badgeText: 'Commercial / Industrial', storeKeys: ['moglix', 'industrybuying', 'amazonbusiness'] },
    { category: 'global', title: `Export Quality ${query}`, minPrice: 0, maxPrice: 0, badgeText: 'Global / Import', storeKeys: ['alibaba'] }
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
        let stores = [];
        
        // सभी स्टोर्स जोड़ें
        const categoryStoresMap = {
          retail: ['meesho', 'flipkart', 'jiomart', 'shopclues', 'myntra', 'ajio', 'tatacliq', 'amazon'],
          wholesale: ['udaan', 'indiamart', 'tradeindia', 'flipkartwholesale', 'jumbotail', 'ninjacart'],
          reselling: ['meesho', 'navo', 'glowroad', 'shop101'],
          grocery: ['blinkit', 'zepto', 'instamart', 'bigbasket'],
          commercial: ['moglix', 'industrybuying', 'amazonbusiness'],
          global: ['alibaba']
        };

        const requiredStores = categoryStoresMap[item.category] || ['meesho', 'flipkart', 'amazon'];

        // 🔴 AI की दी हुई रेंज का उपयोग करें (अगर AI ने नहीं दी, तो फॉलबैक का उपयोग करें)
        let min = Number(item.minPrice) || 0;
        let max = Number(item.maxPrice) || 0;

        // अगर AI ने 0 या गलत कीमत दी है, तो हमारा स्मार्ट फॉलबैक इस्तेमाल करें
        if (min <= 0 || max <= 0) {
          const fallback = getFallbackPriceRange(item.category, item.title);
          min = fallback.min;
          max = fallback.max;
        }

        // सुनिश्चित करें कि max, min से कम न हो
        if (max < min) max = min * 2;

        let tempStores = [];

        requiredStores.forEach((key) => {
          const storeConfig = STORES[key];
          if (storeConfig) {
            // बेस प्राइस (min के आस-पास)
            let basePrice = min + Math.floor(Math.random() * (max * 0.1)); 
            
            // स्टोर के हिसाब से कीमत बढ़ाएं (Smart Weightage)
            const multiplier = getStorePriceMultiplier(key);
            basePrice = Math.floor(basePrice * multiplier);

            // रेंज बनाएं (बेस प्राइस से लेकर 1.5 गुना तक)
            const increase = Math.floor(Math.random() * (basePrice * 0.5)) + Math.floor(basePrice * 0.1);
            const highPrice = basePrice + increase;

            tempStores.push({
              name: storeConfig.name,
              price: `₹${basePrice} - ₹${highPrice}`, 
              isLowest: false, 
              key: key,
              baseNum: basePrice, // कैलकुलेशन के लिए
              link: buildAffiliateLink(key, cleanQuery, storeConfig.name)
            });
          }
        });

        // अब सही "Lowest" (सस्ता) टैग लगाएं
        let minPriceValue = Infinity;
        let minPriceIndex = -1;
        
        tempStores.forEach((s, i) => {
          if (s.baseNum < minPriceValue) {
            minPriceValue = s.baseNum;
            minPriceIndex = i;
          }
        });

        if (minPriceIndex !== -1) {
          tempStores[minPriceIndex].isLowest = true;
        }

        // baseNum हटा दें
        stores = tempStores.map(({ baseNum, ...rest }) => rest);

        return {
          category: item.category || 'retail',
          title: item.title ? String(item.title) : cleanQuery,
          image: '', 
          badgeText: item.badgeText || 'Retail',
          stores
        };
      })
      .filter(item => item.stores.length > 0);

    finalProducts = finalProducts.map(p => {
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
