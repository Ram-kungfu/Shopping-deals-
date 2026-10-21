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

// ==================== 🔴 SMART AUTO-PRICE DATABASE ====================
// 200+ keywords के साथ। जो भी item search करें, यह उसकी realistic range देगा।
const PRICE_DATABASE = [
  // ---- Electronics ----
  { kw: ['iphone', 'apple phone'], min: 45000, max: 150000 },
  { kw: ['samsung galaxy', 'samsung mobile', 'samsung phone'], min: 12000, max: 90000 },
  { kw: ['oneplus', 'one plus'], min: 20000, max: 60000 },
  { kw: ['redmi', 'xiaomi', 'mi phone'], min: 7000, max: 35000 },
  { kw: ['realme', 'oppo', 'vivo', 'poco'], min: 8000, max: 40000 },
  { kw: ['mobile', 'smartphone', 'phone', '5g phone'], min: 10000, max: 35000 },
  { kw: ['laptop', 'notebook', 'macbook'], min: 30000, max: 80000 },
  { kw: ['gaming laptop'], min: 55000, max: 150000 },
  { kw: ['computer', 'desktop', 'pc'], min: 18000, max: 60000 },
  { kw: ['tablet', 'ipad'], min: 10000, max: 45000 },
  { kw: ['tv', 'television', 'smart tv', 'led tv'], min: 10000, max: 50000 },
  { kw: ['fridge', 'refrigerator'], min: 8000, max: 40000 },
  { kw: ['washing machine'], min: 12000, max: 35000 },
  { kw: ['ac', 'air conditioner'], min: 20000, max: 55000 },
  { kw: ['microwave', 'oven'], min: 4000, max: 20000 },
  { kw: ['headphone', 'earphone', 'earbuds', 'airpods', 'headset'], min: 300, max: 8000 },
  { kw: ['speaker', 'bluetooth speaker', 'soundbar'], min: 500, max: 15000 },
  { kw: ['camera', 'dslr', 'gopro'], min: 8000, max: 80000 },
  { kw: ['smartwatch', 'watch'], min: 500, max: 20000 },
  { kw: ['printer', 'scanner'], min: 3000, max: 25000 },
  { kw: ['router', 'wifi router'], min: 500, max: 5000 },
  { kw: ['pendrive', 'hard disk', 'harddrive', 'ssd'], min: 300, max: 8000 },
  { kw: ['power bank'], min: 500, max: 3000 },
  { kw: ['keyboard', 'mouse'], min: 200, max: 3000 },
  { kw: ['monitor'], min: 6000, max: 30000 },
  
  // ---- Fashion ----
  { kw: ['shirt'], min: 250, max: 1500 },
  { kw: ['tshirt', 't-shirt'], min: 200, max: 1200 },
  { kw: ['jeans', 'denim'], min: 400, max: 2500 },
  { kw: ['pant', 'trouser'], min: 350, max: 2000 },
  { kw: ['kurti', 'kurta', 'saree'], min: 300, max: 3000 },
  { kw: ['dress', 'frock', 'gown'], min: 400, max: 4000 },
  { kw: ['suit', 'blazer'], min: 1500, max: 10000 },
  { kw: ['shoe', 'sneaker', 'footwear'], min: 500, max: 6000 },
  { kw: ['sandal', 'chappal', 'slipper'], min: 150, max: 1500 },
  { kw: ['bag', 'backpack', 'handbag'], min: 400, max: 5000 },
  { kw: ['watch', 'wrist watch'], min: 300, max: 5000 },
  { kw: ['sunglasses', 'goggles'], min: 200, max: 3000 },
  
  // ---- Daily Use / Small Items ----
  { kw: ['pen', 'ball pen', 'gel pen'], min: 5, max: 100 },
  { kw: ['pencil'], min: 3, max: 50 },
  { kw: ['notebook', 'copy', 'register'], min: 20, max: 300 },
  { kw: ['needle', 'sui', 'sui dhaaga'], min: 5, max: 150 },
  { kw: ['soap'], min: 20, max: 250 },
  { kw: ['shampoo'], min: 80, max: 800 },
  { kw: ['toothpaste'], min: 30, max: 350 },
  { kw: ['brush', 'toothbrush'], min: 20, max: 250 },
  { kw: ['comb'], min: 15, max: 150 },
  { kw: ['towel'], min: 100, max: 800 },
  { kw: ['bedsheet'], min: 300, max: 2000 },
  { kw: ['pillow'], min: 200, max: 1500 },
  { kw: ['bottle', 'water bottle'], min: 100, max: 1500 },
  { kw: ['tiffin', 'lunch box'], min: 150, max: 1200 },
  { kw: ['umbrella'], min: 200, max: 1500 },
  
  // ---- Grocery ----
  { kw: ['rice', 'chawal'], min: 40, max: 200 },
  { kw: ['atta', 'flour'], min: 30, max: 150 },
  { kw: ['dal', 'pulse'], min: 60, max: 250 },
  { kw: ['oil', 'cooking oil'], min: 100, max: 500 },
  { kw: ['sugar', 'cheeni'], min: 40, max: 100 },
  { kw: ['tea', 'chai', 'coffee'], min: 100, max: 800 },
  { kw: ['milk', 'doodh'], min: 25, max: 100 },
  { kw: ['biscuit', 'chocolate'], min: 10, max: 200 },
  { kw: ['namkeen', 'chips'], min: 20, max: 200 },
  { kw: ['masala', 'spice'], min: 30, max: 400 },
  
  // ---- Kitchen & Home ----
  { kw: ['mixer', 'grinder', 'blender'], min: 1500, max: 8000 },
  { kw: ['cooker', 'pressure cooker'], min: 800, max: 4000 },
  { kw: ['pan', 'kadhai', 'tawa'], min: 300, max: 2500 },
  { kw: ['plate', 'bowl', 'glass'], min: 50, max: 800 },
  { kw: ['fan', 'ceiling fan'], min: 1200, max: 5000 },
  { kw: ['bulb', 'led bulb'], min: 80, max: 800 },
  { kw: ['chair', 'table', 'furniture'], min: 1000, max: 15000 },
  { kw: ['sofa'], min: 10000, max: 80000 },
  { kw: ['mattress'], min: 3000, max: 25000 },
  
  // ---- Toys & Kids ----
  { kw: ['toy', 'toys', 'remote car'], min: 100, max: 3000 },
  { kw: ['doll', 'teddy bear'], min: 150, max: 1500 },
  { kw: ['puzzle', 'board game'], min: 100, max: 2000 },
  { kw: ['cycle', 'bicycle'], min: 3000, max: 20000 },
  
  // ---- Sports & Health ----
  { kw: ['cricket bat', 'bat'], min: 500, max: 5000 },
  { kw: ['football', 'volleyball'], min: 300, max: 2000 },
  { kw: ['yoga mat'], min: 200, max: 1500 },
  { kw: ['dumbbell', 'gym equipment'], min: 500, max: 8000 },
  { kw: ['protein', 'supplement'], min: 800, max: 5000 },
  
  // ---- Beauty & Personal Care ----
  { kw: ['cream', 'face cream'], min: 100, max: 1500 },
  { kw: ['lipstick'], min: 150, max: 2000 },
  { kw: ['perfume', 'deodorant'], min: 200, max: 5000 },
  { kw: ['trimmer', 'shaver'], min: 500, max: 4000 },
  { kw: ['hair dryer'], min: 500, max: 3000 },
  
  // ---- Tools & Hardware ----
  { kw: ['hammer', 'screwdriver', 'tool'], min: 100, max: 1500 },
  { kw: ['drill', 'drill machine'], min: 1500, max: 12000 },
  { kw: ['paint', 'paint bucket'], min: 200, max: 3000 },
  { kw: ['wire', 'cable'], min: 100, max: 2000 },
  
  // ---- Stationery & Office ----
  { kw: ['stapler', 'punching machine'], min: 50, max: 500 },
  { kw: ['file', 'folder'], min: 20, max: 300 },
  { kw: ['calculator'], min: 100, max: 1500 },
  { kw: ['whiteboard', 'board'], min: 500, max: 5000 },
  
  // ---- Books ----
  { kw: ['book', 'novel', 'textbook'], min: 100, max: 1500 },
  { kw: ['comic', 'magazine'], min: 50, max: 800 },
  
  // ---- Baby Products ----
  { kw: ['diaper', 'pampers'], min: 200, max: 1500 },
  { kw: ['baby food'], min: 200, max: 800 },
  { kw: ['stroller', 'pram'], min: 2000, max: 15000 },
  
  // ---- Furniture / Big Items ----
  { kw: ['almari', 'wardrobe'], min: 5000, max: 40000 },
  { kw: ['bed'], min: 5000, max: 40000 },
  { kw: ['dining table'], min: 5000, max: 35000 },
  
  // ---- Vehicles (basic) ----
  { kw: ['bike', 'motorcycle', 'scooter'], min: 50000, max: 250000 },
  { kw: ['car'], min: 300000, max: 1500000 },
  { kw: ['car tyre', 'tyre'], min: 1500, max: 12000 },
];

// 🔍 Auto-detect realistic price range from keyword
function detectPriceRangeByKeyword(title) {
  const t = String(title).toLowerCase().trim();
  
  // सबसे पहले longest keyword match करें (specific से general)
  let bestMatch = null;
  let bestLen = 0;
  
  for (const entry of PRICE_DATABASE) {
    for (const kw of entry.kw) {
      // Word boundary check to avoid "pen" matching "pendrive"
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
      if (regex.test(t)) {
        if (kw.length > bestLen) {
          bestLen = kw.length;
          bestMatch = entry;
        }
      }
    }
  }
  
  if (bestMatch) {
    return { min: bestMatch.min, max: bestMatch.max };
  }
  
  return null;
}

// Category-aware fallback (जब keyword भी match न हो)
function getFallbackPriceRange(category) {
  switch (String(category).toLowerCase()) {
    case 'retail':      return { min: 500,   max: 5000 };
    case 'wholesale':   return { min: 200,   max: 2000 };
    case 'reselling':   return { min: 150,   max: 800 };
    case 'grocery':     return { min: 50,    max: 500 };
    case 'commercial':  return { min: 1000,  max: 10000 };
    case 'global':      return { min: 500,   max: 5000 };
    default:            return { min: 250,   max: 3000 };
  }
}

// Category के हिसाब से price range को adjust करें
// (Wholesale = 30% कम, Retail = as-is, Commercial = 5x, etc.)
function adjustRangeForCategory(baseRange, category) {
  const { min, max } = baseRange;
  switch (String(category).toLowerCase()) {
    case 'retail':      return { min: Math.round(min),               max: Math.round(max) };
    case 'wholesale':   return { min: Math.round(min * 0.55),        max: Math.round(max * 0.7) };
    case 'reselling':   return { min: Math.round(min * 0.45),        max: Math.round(max * 0.6) };
    case 'grocery':     return { min: Math.round(Math.max(10, min * 0.3)), max: Math.round(max * 0.4) };
    case 'commercial':  return { min: Math.round(min * 1.2),         max: Math.round(max * 2.5) };
    case 'global':      return { min: Math.round(min * 1.5),         max: Math.round(max * 3) };
    default:            return { min, max };
  }
}

// Store के हिसाब से price multiplier (realistic market behaviour)
function getStorePriceMultiplier(storeKey) {
  const key = String(storeKey).toLowerCase();
  if (['meesho', 'udaan', 'glowroad', 'shop101', 'navo'].includes(key)) return 0.95;
  if (['flipkart', 'jiomart', 'shopclues', 'tatacliq'].includes(key)) return 1.10;
  if (['myntra', 'ajio'].includes(key)) return 1.25;
  if (['amazon', 'amazonbusiness'].includes(key)) return 1.40;
  if (['blinkit', 'zepto', 'instamart', 'bigbasket'].includes(key)) return 1.08;
  if (['indiamart', 'tradeindia', 'flipkartwholesale', 'jumbotail', 'ninjacart'].includes(key)) return 0.85;
  if (['moglix', 'industrybuying'].includes(key)) return 1.15;
  if (['alibaba'].includes(key)) return 0.70;
  return 1.10;
}

// Price को nice format में दिखाएं (₹1,234 - ₹2,567)
function formatPrice(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
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
  console.warn('⚠️  GEMINI_API_KEY not set — using smart keyword fallback.');
}

function buildPrompt(query) {
  return `You are an expert Indian e-commerce price estimation AI.

User search query: "${query}"

TASK:
Generate a JSON array of AT LEAST 6 product objects, one for each category:
"retail", "wholesale", "reselling", "grocery", "commercial", "global"

For EACH product you MUST estimate a REALISTIC minimum and maximum price in Indian Rupees (₹) based on what that item actually costs in India. 
Think carefully about the actual product. Examples:
- "pen" → retail ₹10-₹50, wholesale ₹3-₹20, grocery ₹5-₹30
- "iphone 15" → retail ₹65000-₹85000, wholesale ₹60000-₹78000, global ₹55000-₹70000
- "shirt" → retail ₹300-₹1500, wholesale ₹150-₹700, reselling ₹200-₹900
- "laptop" → retail ₹30000-₹80000, commercial ₹35000-₹95000
- "rice 1kg" → grocery ₹40-₹120

STRICT OUTPUT — return ONLY raw JSON array (no markdown, no code fences, no text before/after):

[
  {
    "category": "retail",
    "title": "Exact Full Product Name",
    "minPrice": 100,
    "maxPrice": 500,
    "badgeText": "Retail / Consumer",
    "storeKeys": ["amazon", "flipkart", "meesho"]
  }
]

RULES:
1. "minPrice" and "maxPrice" MUST be realistic numbers (₹, no symbol).
2. minPrice MUST be less than maxPrice. Both MUST be > 0.
3. "storeKeys" must use lowercase keys from: amazon, flipkart, meesho, myntra, ajio, tatacliq, jiomart, shopclues, blinkit, zepto, instamart, bigbasket, indiamart, udaan, tradeindia, flipkartwholesale, jumbotail, ninjacart, amazonbusiness, moglix, industrybuying, alibaba, glowroad, shop101, navo
4. DO NOT include "price" or "stores" arrays — server generates them.
5. Leave "image" as empty string.
6. Each category MUST be present exactly once.`;
}

function getFallbackResults(query) {
  return [
    { category: 'retail',    title: `${query}`,                    badgeText: 'Retail / Consumer',       storeKeys: ['meesho','flipkart','jiomart','shopclues','myntra','ajio','tatacliq','amazon'] },
    { category: 'wholesale', title: `Bulk ${query}`,               badgeText: 'Wholesale / B2B',         storeKeys: ['udaan','indiamart','tradeindia','flipkartwholesale','jumbotail','ninjacart'] },
    { category: 'reselling', title: `${query} for Resellers`,      badgeText: 'Reselling & Social',      storeKeys: ['meesho','navo','glowroad','shop101'] },
    { category: 'grocery',   title: `${query} (Quick Delivery)`,   badgeText: 'Grocery & Quick',         storeKeys: ['blinkit','zepto','instamart','bigbasket'] },
    { category: 'commercial',title: `Commercial ${query}`,         badgeText: 'Commercial / Industrial', storeKeys: ['moglix','industrybuying','amazonbusiness'] },
    { category: 'global',    title: `Export ${query}`,             badgeText: 'Global / Import',         storeKeys: ['alibaba'] }
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

    // Cache check
    const cachedData = searchCache.get(cleanQuery);
    if (cachedData) {
      if (Date.now() - cachedData.timestamp < CACHE_EXPIRY_MS) {
        return res.json({ success: true, products: cachedData.products, fromCache: true });
      }
      searchCache.delete(cleanQuery);
    }

    // 🔴 Step 1: Get base price from keyword database (works ALWAYS)
    const keywordRange = detectPriceRangeByKeyword(cleanQuery);

    // 🔴 Step 2: Ask AI (if available) for products + prices
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
      // Fill missing categories from fallback
      const existingCats = products.map(p => p.category);
      getFallbackResults(cleanQuery).forEach(fbItem => {
        if (!existingCats.includes(fbItem.category)) products.push(fbItem);
      });
    }

    // 🔴 Step 3: Build final products with SMART PRICING
    const categoryStoresMap = {
      retail:     ['meesho', 'flipkart', 'jiomart', 'shopclues', 'myntra', 'ajio', 'tatacliq', 'amazon'],
      wholesale:  ['udaan', 'indiamart', 'tradeindia', 'flipkartwholesale', 'jumbotail', 'ninjacart'],
      reselling:  ['meesho', 'navo', 'glowroad', 'shop101'],
      grocery:    ['blinkit', 'zepto', 'instamart', 'bigbasket'],
      commercial: ['moglix', 'industrybuying', 'amazonbusiness'],
      global:     ['alibaba']
    };

    let finalProducts = products
      .filter(item => item && typeof item === 'object')
      .map(item => {
        const category = item.category || 'retail';

        // --- 1. AI से कीमत (min/max) ---
        let aiMin = Number(item.minPrice) || 0;
        let aiMax = Number(item.maxPrice) || 0;
        if (aiMax < aiMin) [aiMin, aiMax] = [aiMax, aiMin];

        // --- 2. Keyword DB से range (priority: AI > keyword DB > category fallback) ---
        let range;
        if (aiMin > 0 && aiMax > 0) {
          // AI ने दिया है, तो उसे use करें
          range = { min: aiMin, max: aiMax };
        } else if (keywordRange) {
          // AI ने नहीं दिया, keyword DB से लें + category adjust करें
          range = adjustRangeForCategory(keywordRange, category);
        } else {
          // कुछ भी नहीं मिला, तो category fallback
          range = getFallbackPriceRange(category);
        }

        // safety: max >= min * 1.15 always
        if (range.max <= range.min * 1.15) range.max = Math.round(range.min * 1.5);

        // --- 3. हर store के लिए price calculate करें ---
        const requiredStores = categoryStoresMap[category] || categoryStoresMap.retail;
        const tempStores = [];

        requiredStores.forEach((key, idx) => {
          const storeConfig = STORES[key];
          if (!storeConfig) return;

          const multiplier = getStorePriceMultiplier(key);
          
          // Store-level randomization (±8%) — same store हर बार अलग price दिखाए
          const jitter = 0.92 + Math.random() * 0.16;
          
          let storeMin = range.min * multiplier * jitter;
          let storeMax = range.max * multiplier * jitter;
          
          // सुनिश्चित करें storeMax > storeMin
          if (storeMax <= storeMin) storeMax = storeMin * 1.3;

          // Round nicely (₹1 के multiples)
          storeMin = Math.max(1, Math.round(storeMin));
          storeMax = Math.max(storeMin + 1, Math.round(storeMax));

          tempStores.push({
            name: storeConfig.name,
            price: `${formatPrice(storeMin)} - ${formatPrice(storeMax)}`,
            isLowest: false,
            key: key,
            baseNum: storeMin, // lowest detection के लिए
            link: buildAffiliateLink(key, cleanQuery, storeConfig.name)
          });
        });

        // --- 4. सबसे सस्ते store पर "Lowest" badge ---
        if (tempStores.length > 0) {
          let minIdx = 0;
          let minVal = Infinity;
          tempStores.forEach((s, i) => {
            if (s.baseNum < minVal) { minVal = s.baseNum; minIdx = i; }
          });
          tempStores[minIdx].isLowest = true;
        }

        // baseNum remove
        const stores = tempStores.map(({ baseNum, ...rest }) => rest);

        return {
          category,
          title: item.title ? String(item.title) : cleanQuery,
          image: '',
          badgeText: item.badgeText || 'Retail',
          priceRange: `${formatPrice(range.min)} - ${formatPrice(range.max)}`,
          stores
        };
      })
      .filter(item => item.stores.length > 0);

    // Placeholder images
    finalProducts = finalProducts.map(p => {
      if (!p.image) p.image = placeholderImage(p.title);
      return p;
    });

    // Cache
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
  res.json({
    status: 'ok',
    ai: !!ai,
    model: GEMINI_MODEL,
    cachedItems: searchCache.size,
    keywordDbSize: PRICE_DATABASE.reduce((s, e) => s + e.kw.length, 0),
    timestamp: new Date().toISOString()
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🛒 Shopping Deals Server running on port ${PORT}`);
  console.log(`🤖 Gemini AI: ${ai ? '✅ Active (' + GEMINI_MODEL + ')' : '⚠️  Fallback mode'}`);
  console.log(`📊 Keyword DB: ${PRICE_DATABASE.reduce((s, e) => s + e.kw.length, 0)} keywords loaded`);
});
