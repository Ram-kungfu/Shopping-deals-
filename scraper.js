const fs = require('fs');

// आपके प्रोडक्ट्स का डेटा (या आप चाहें तो एपीआई/स्क्रैपर से फेच कर सकते हैं)
const productsList = [
    {
        "title": "ऑटोमैटिक अपडेटेड प्रोडक्ट 1",
        "image": "https://images.unsplash.com/photo-1...",
        "rawUrl": "https://www.meesho.com/p/sample1"
    },
    {
        "title": "ऑटोमैटिक अपडेटेड प्रोडक्ट 2",
        "image": "https://images.unsplash.com/photo-2...",
        "rawUrl": "https://www.meesho.com/p/sample2"
    }
];

// 'products.json' फाइल को रूट फोल्डर में सेव करना
fs.writeFileSync('products.json', JSON.stringify(productsList, null, 4), 'utf-8');
console.log("products.json successfully updated!");

