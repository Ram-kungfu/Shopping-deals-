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

// ==================== CUELINKS CONFIG ====================
const CUELINKS_ID = '330736';
const CUELINKS_SOURCE = 'linkkit';

// 🔴 सभी स्टोर्स के लिए Cuelinks वाले लिंक
const STORES = {
  // जहाँ आपके पास स्पेसिफिक लिंक हैं
  shopsy:   { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.shopsy.in%2F`, name: 'Shopsy' },
  shopclues:{ type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.shopclues.com%2F`, name: 'ShopClues' },
  tatacliq: { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.tatacliq.com%2F`, name: 'TataCLiQ' },
  moglix:   { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.moglix.com%2F`, name: 'Moglix' },
  alibaba:  { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Foffer.alibaba.com%2F`, name: 'Alibaba' },

  // जहाँ स्पेसिफिक लिंक नहीं हैं, वहाँ स्टैंडर्ड Cuelinks रीडायरेक्ट
  amazon:   { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.amazon.in%2F`, name: 'Amazon' },
  flipkart: { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.flipkart.com%2F`, name: 'Flipkart' },
  meesho:   { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.meesho.com%2F`, name: 'Meesho' },
  myntra:   { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.myntra.com%2F`, name: 'Myntra' },
  ajio:     { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.ajio.com%2F`, name: 'Ajio' },
  jiomart:  { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.jiomart.com%2F`, name: 'JioMart' },
  blinkit:  { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fblinkit.com%2F`, name: 'Blinkit' },
  zepto:    { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.zeptonow.com%2F`, name: 'Zepto' },
  instamart:{ type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.swiggy.com%2Finstamart`, name: 'Instamart' },
  bigbasket:{ type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.bigbasket.com%2F`, name: 'BigBasket' },
  indiamart:{ type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fdir.indiamart.com%2F`, name: 'IndiaMART' },
  udaan:    { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.udaan.com%2F`, name: 'Udaan' },
  tradeindia:{ type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.tradeindia.com%2F`, name: 'TradeIndia' },
  flipkartwholesale: { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.flipkart.com%2F`, name: 'Flipkart Wholesale' },
  jumbotail:{ type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fjumbotail.com%2F`, name: 'Jumbotail' },
  ninjacart:{ type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fninjacart.in%2F`, name: 'NinjaCart' },
  amazonbusiness: { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.amazon.in%2F`, name: 'Amazon Business' },
  industrybuying: { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.industrybuying.com%2F`, name: 'IndustryBuying' },
  glowroad: { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.glowroad.com%2F`, name: 'GlowRoad' },
  shop101:  { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fwww.shop101.com%2F`, name: 'Shop101' },
  navo:     { type: 'q', base: `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=https%3A%2F%2Fnavo.app%2F`, name: 'Navo' }
};

// ==================== HELPERS ====================
// 🔴 यह फंक्शन लिंक के अंदर सर्च कीवर्ड जोड़ेगा
function buildAffiliateLink(storeKey, query, storeName) {
  const key = String(storeKey || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const store = STORES[key];
  
  // अगर स्टोर नहीं मिला, तो गूगल पर भेजें
  if (!store) {
    return `https://www.google.com/search?q=${encodeURIComponent(query + ' ' + (storeName || '') + ' buy online')}`;
  }

  let searchPath = '';
  
  // हर स्टोर के लिए सर्च का तरीका अलग होता है
  if (key === 'amazon' || key === 'amazonbusiness') searchPath = `s?k=${encodeURIComponent(query)}`;
  else if (key === 'flipkart' || key === 'flipkartwholesale') searchPath = `search?q=${encodeURIComponent(query)}`;
  else if (key === 'meesho') searchPath = `search?q=${encodeURIComponent(query)}`;
  else if (key === 'myntra') searchPath = `${encodeURIComponent(query.replace(/\s+/g, '-'))}`;
  else if (key === 'ajio') searchPath = `search/?text=${encodeURIComponent(query)}`;
  else if (key === 'tatacliq') searchPath = `search/?searchCategory=all&text=${encodeURIComponent(query)}`;
  else if (key === 'jiomart') searchPath = `search/${encodeURIComponent(query)}`;
  else if (key === 'shopclues') searchPath = `search?q=${encodeURIComponent(query)}`;
  else if (key === 'blinkit') searchPath = `s/?q=${encodeURIComponent(query)}`;
  else if (key === 'zepto') searchPath = `search?query=${encodeURIComponent(query)}`;
  else if (key === 'instamart') searchPath = `search?custom_back=true&query=${encodeURIComponent(query)}`;
  else if (key === 'bigbasket') searchPath = `ps/?q=${encodeURIComponent(query)}`;
  else if (key === 'indiamart') searchPath = `search.mp?ss=${encodeURIComponent(query)}`;
  else if (key === 'udaan') searchPath = `search?q=${encodeURIComponent(query)}`;
  else if (key === 'tradeindia') searchPath = `search.html?keyword=${encodeURIComponent(query)}`;
  else if (key === 'jumbotail') searchPath = `search?q=${encodeURIComponent(query)}`;
  else if (key === 'ninjacart') searchPath = `search?q=${encodeURIComponent(query)}`;
  else if (key === 'moglix') searchPath = `search?q=${encodeURIComponent(query)}`;
  else if (key === 'industrybuying') searchPath = `search/?q=${encodeURIComponent(query)}`;
  else if (key === 'alibaba') searchPath = `trade/search?SearchText=${encodeURIComponent(query)}`;
  else if (key === 'shopsy') searchPath = `search?q=${encodeURIComponent(query)}`;
  else searchPath = `search?q=${encodeURIComponent(query)}`;

  // store.base में जो url= है, उसे निकालें
  let baseWebsite = '';
  const urlMatch = store.base.match(/url=([^&]+)/);
  if (urlMatch && urlMatch[1]) {
    baseWebsite = decodeURIComponent(urlMatch[1]);
  } else {
    baseWebsite = store.base;
  }

  if (!baseWebsite.endsWith('/')) baseWebsite += '/';

  // पूरा सर्च URL बनाएं
  const fullSearchUrl = baseWebsite + searchPath;

  // 🔴 अब इसे फिर से Cuelinks में डालें
  return `https://linksredirect.com/?cid=${CUELINKS_ID}&source=${CUELINKS_SOURCE}&url=${encodeURIComponent(fullSearchUrl)}`;
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

// ==================== SMART AUTO-PRICE DATABASE ====================
const PRICE_DATABASE = [
  // ---- Electronics ----
  { kw: ['iphone', 'apple phone'], min: 45000, max: 150000 },
  { kw: ['macbook', 'apple laptop'], min: 70000, max: 250000 },
  { kw: ['thinkpad', 'lenovo laptop', 'hp laptop', 'dell laptop', 'asus laptop', 'acer laptop'], min: 30000, max: 120000 },
  { kw: ['gaming laptop'], min: 55000, max: 200000 },
  { kw: ['laptop', 'notebook'], min: 25000, max: 90000 },
  { kw: ['samsung galaxy', 'samsung mobile', 'samsung phone'], min: 12000, max: 90000 },
  { kw: ['oneplus', 'one plus'], min: 20000, max: 60000 },
  { kw: ['redmi', 'xiaomi', 'mi phone'], min: 7000, max: 35000 },
  { kw: ['realme', 'oppo', 'vivo', 'poco'], min: 8000, max: 40000 },
  { kw: ['mobile', 'smartphone', 'phone', '5g phone'], min: 8000, max: 40000 },
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
  { kw: ['smartwatch'], min: 800, max: 20000 },
  { kw: ['watch'], min: 300, max: 5000 },
  { kw: ['printer', 'scanner'], min: 3000, max: 25000 },
  { kw: ['router', 'wifi router'], min: 500, max: 5000 },
  { kw: ['pendrive', 'hard disk', 'harddrive', 'ssd'], min: 300, max: 8000 },
  { kw: ['power bank'], min: 500, max: 3000 },
  { kw: ['keyboard', 'mouse'], min: 200, max: 3000 },
  { kw: ['monitor'], min: 6000, max: 30000 },
  { kw: ['pos system', 'pos machine'], min: 15000, max: 60000 },
  
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
  
  // ---- Vehicles ----
  { kw: ['bike', 'motorcycle', 'scooter'], min: 50000, max: 250000 },
  { kw: ['car'], min: 300000, max: 1500000 },
  { kw: ['car tyre', 'tyre'], min: 1500, max: 12000 },
];

// 🔍 Auto-detect realistic price range from keyword
function detectPriceRangeByKeyword(title) {
  const t = String(title).toLowerCase().trim();
  let bestMatch = null;
  let bestLen = 0;
  
  for (const entry of PRICE_DATABASE) {
    for (const kw of entry.kw) {
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
  
  if (bestMatch) return { min: bestMatch.min, max: bestMatch.max };
  return null;
}

// Category-aware fallback
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

// 🔴 सुधारा गया Category Adjuster (अब कीमतें 10% से ज्यादा नहीं गिरेंगी)
function adjustRangeForCategory(baseRange, category) {
  const { min, max } = baseRange;
  switch (String(category).toLowerCase()) {
    case 'retail':      return { min: Math.round(min),          max: Math.round(max) };
    case 'wholesale':   return { min: Math.round(min * 0.90),   max: Math.round(max * 0.90) }; // Bulk discount 10%
    case 'reselling':   return { min: Math.round(min * 0.85),   max: Math.round(max * 0.85) }; // Reseller discount 15%
    case 'grocery':     return { min: Math.round(min),          max: Math.round(max) };
    case 'commercial':  return { min: Math.round(min * 1.05),   max: Math.round(max * 1.05) }; // Slightly higher
    case 'global':      return { min: Math.round(min * 1.15),   max: Math.round(max * 1.15) }; // Import premium
    default:            return { min, max };
  }
}

// Store के हिसाब से price multiplier
function getStorePriceMultiplier(storeKey) {
  const key = String(storeKey).toLowerCase();
  if (['meesho', 'udaan', 'glowroad', 'shop101', 'navo'].includes(key)) return 0.95;
  if (['flipkart', 'jiomart', 'shopclues', 'tatacliq'].includes(key)) return 1.05;
  if (['myntra', 'ajio'].includes(key)) return 1.15;
  if (['amazon', 'amazonbusiness'].includes(key)) return 1.20;
  if (['blinkit', 'zepto', 'instamart', 'bigbasket'].includes(key)) return 1.10;
  if (['indiamart', 'tradeindia', 'flipkartwholesale', 'jumbotail', 'ninjacart'].includes(key)) return 0.85;
  if (['moglix', 'industrybuying'].includes(key)) return 1.10;
  if (['alibaba'].includes(key)) return 0.80;
  return 1.00;
}

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
Generate a JSON array of AT LEAST 6 product objects, one for each category: "retail", "wholesale", "reselling", "grocery", "commercial", "global".

For EACH product you MUST estimate a REALISTIC minimum and maximum price in Indian Rupees (₹) based on what that item actually costs in India. 
CRITICAL: Think carefully about the actual item. Never undervalue expensive items.
- "laptop" → retail ₹30000-₹80000, wholesale ₹25000-₹70000
- "macbook" → retail ₹90000-₹150000
- "pen" → retail ₹10-₹50, wholesale ₹3-₹20
- "iphone 15" → retail ₹65000-₹85000

STRICT OUTPUT — return ONLY raw JSON array (no markdown, no code fences):

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
1. "minPrice" and "maxPrice" MUST be realistic numbers (₹, no symbol). Laptop की कीमत 5000 से कम कभी नहीं होगी।
2. minPrice MUST be less than maxPrice. Both MUST be > 0.
3. "storeKeys" must use lowercase keys from: amazon, flipkart, meesho, myntra, ajio, tatacliq, jiomart, blinkit, zepto, instamart, bigbasket, indiamart, udaan, tradeindia, flipkartwholesale, jumbotail, ninjacart, amazonbusiness, moglix, industrybuying, alibaba
4. Each category MUST be present exactly once.`;
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

    // 🔴 Step 1: Get base price from keyword database
    let keywordRange = detectPriceRangeByKeyword(cleanQuery);

    // 🔴 SANITY CHECK 1: अगर लैपटॉप है और रेंज बहुत कम है, तो उसे सुधारें
    const isLaptop = /laptop|macbook|notebook/i.test(cleanQuery);
    if (isLaptop && (!keywordRange || keywordRange.max < 20000)) {
        keywordRange = { min: 25000, max: 90000 };
    }

    // 🔴 Step 2: Ask AI
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
      getFallbackResults(cleanQuery).forEach(fbItem => {
        if (!existingCats.includes(fbItem.category)) products.push(fbItem);
      });
    }

    // 🔴 Step 3: Build final products
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

        // 1. AI से कीमत
        let aiMin = Number(item.minPrice) || 0;
        let aiMax = Number(item.maxPrice) || 0;
        if (aiMax < aiMin) [aiMin, aiMax] = [aiMax, aiMin];

        // 🔴 SANITY CHECK 2: AI की गलत कीमतों को रोकें (The Main Fix)
        // अगर AI किसी लैपटॉप/मोबाइल की कीमत ₹2000 बताता है, तो उसे रिजेक्ट करें
        if (aiMin > 0 && aiMax > 0) {
            if (isLaptop && aiMax < 20000) {
                // AI ने लैपटॉप की गलत कीमत दी, इसे इग्नोर करें
                aiMin = 0; aiMax = 0; 
            } else if (/mobile|phone|smartphone|iphone/i.test(cleanQuery) && aiMax < 3000) {
                 // AI ने मोबाइल की गलत कीमत दी
                 aiMin = 0; aiMax = 0; 
            }
        }

        // 2. Range तय करें
        let range;
        if (aiMin > 0 && aiMax > 0) {
          range = { min: aiMin, max: aiMax };
        } else if (keywordRange) {
          range = adjustRangeForCategory(keywordRange, category);
        } else {
          range = getFallbackPriceRange(category);
        }

        // safety: max >= min * 1.15 always
        if (range.max <= range.min * 1.15) range.max = Math.round(range.min * 1.5);

        // 3. हर store के लिए price calculate करें
        const requiredStores = categoryStoresMap[category] || categoryStoresMap.retail;
        const tempStores = [];

        requiredStores.forEach((key) => {
          const storeConfig = STORES[key];
          if (!storeConfig) return;

          const multiplier = getStorePriceMultiplier(key);
          
          // Store-level randomization (हल्का सा बदलाव)
          const jitter = 0.95 + Math.random() * 0.10; // 0.95 से 1.05
          
          let storeMin = range.min * multiplier * jitter;
          let storeMax = range.max * multiplier * jitter;
          
          if (storeMax <= storeMin) storeMax = storeMin * 1.2;

          storeMin = Math.max(1, Math.round(storeMin));
          storeMax = Math.max(storeMin + 1, Math.round(storeMax));

          tempStores.push({
            name: storeConfig.name,
            price: `${formatPrice(storeMin)} - ${formatPrice(storeMax)}`,
            isLowest: false,
            key: key,
            baseNum: storeMin,
            link: buildAffiliateLink(key, cleanQuery, storeConfig.name)
          });
        });

        // 4. सबसे सस्ते store पर "Lowest" badge
        if (tempStores.length > 0) {
          let minIdx = 0;
          let minVal = Infinity;
          tempStores.forEach((s, i) => {
            if (s.baseNum < minVal) { minVal = s.baseNum; minIdx = i; }
          });
          tempStores[minIdx].isLowest = true;
        }

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
  res.json({ status: 'ok', ai: !!ai, model: GEMINI_MODEL });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🛒 Shopping Deals Server running on port ${PORT}`);
  console.log(`🤖 Gemini AI: ${ai ? '✅ Active (' + GEMINI_MODEL + ')' : '⚠️  Fallback mode'}`);
});
