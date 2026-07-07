// One-off helper: find a Wikimedia Commons photo for each recipe and print a
// JSON map of recipe id -> { url, page }. Run: node fetch_photos.mjs
// Not part of the app runtime.

const QUERIES = {
  'spag-bol': 'spaghetti bolognese',
  'chicken-stirfry': 'chicken stir fry vegetables',
  'fried-rice': 'egg fried rice',
  'butter-chicken': 'butter chicken curry',
  'thai-green-curry': 'thai green curry',
  'salmon-tray': 'baked salmon broccoli',
  'tacos': 'beef tacos',
  'carbonara': 'spaghetti carbonara',
  'chickpea-curry': 'chickpea curry chana masala',
  'stir-fry-noodles': 'prawn noodles stir fry',
  'roast-chicken': 'roast chicken dinner',
  'shakshuka': 'shakshuka',
  'pumpkin-soup': 'pumpkin soup',
  'fish-tacos': 'fish tacos',
  'pad-thai-ish': 'peanut sauce noodles',
  'greek-salad-bowl': 'greek salad chicken',
  'mushroom-risotto': 'mushroom risotto',
  'burgers': 'cheeseburger homemade',
  'lentil-soup': 'lentil soup',
  'pancakes': 'pancakes stack',
  'banana-bread': 'banana bread loaf',
  'choc-mug-cake': 'chocolate mug cake',
  'steak-night': 'steak mashed potatoes',
  'tomato-pasta': 'spaghetti tomato sauce basil',
  'chicken-soup': 'chicken noodle soup',
  'quesadillas': 'quesadilla',
  'buddha-bowl': 'buddha bowl food',
  'omelette': 'omelette mushroom',
  'san-choy-bow': 'lettuce wraps pork mince',
  'frittata': 'frittata vegetable',
  'laksa-ish': 'laksa noodle soup',
  'cottage-pie': 'cottage pie shepherd',
  'halloumi-salad': 'grilled halloumi salad',
  'garlic-bread-soup-night': 'tomato soup garlic bread',
  'teriyaki-bowl': 'teriyaki chicken rice bowl',
  'eggplant-parm': 'eggplant parmigiana',
  'nachos': 'nachos tortilla chips melted cheese',
  'oat-brekkie': 'porridge oatmeal banana',
  'tofu-stirfry': 'tofu stir fry vegetables',
  'chicken-parmi': 'chicken parmigiana',
  'lasagna': 'lasagna baked',
  'mac-cheese': 'macaroni and cheese baked',
  'pad-thai': 'pad thai',
  'chicken-alfredo': 'fettuccine alfredo chicken',
  'chilli-con-carne': 'chili con carne',
  'beef-stroganoff': 'beef stroganoff',
  'chicken-satay': 'chicken satay skewers peanut',
  'margherita-pizza': 'margherita pizza',
  'chicken-fajitas': 'chicken fajitas',
  'katsu-curry': 'chicken katsu curry',
  'chicken-ramen': 'ramen bowl egg',
  'caesar-salad': 'caesar salad romaine croutons',
  'french-toast': 'french toast',
  'choc-chip-cookies': 'chocolate chip cookies',
  'brownies': 'chocolate brownies',
  'apple-crumble': 'apple crumble',
  'beef-chow-mein': 'chow mein noodles',
  'tuna-pasta-bake': 'tuna casserole',
  'burrito-bowl': 'burrito bowl rice chicken',
};

const API = 'https://commons.wikimedia.org/w/api.php';

async function findPhoto(query) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: '6',
    gsrlimit: '5',
    prop: 'imageinfo',
    iiprop: 'url|mime',
    iiurlwidth: '640',
    origin: '*',
  });
  const res = await fetch(`${API}?${params}`, {
    headers: { 'User-Agent': 'whats-cooking-recipe-app/1.0 (personal project)' },
  });
  if (!res.ok) throw new Error(`API ${res.status} for "${query}"`);
  const data = await res.json();
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (info && /^image\/(jpeg|png)$/.test(info.mime)) {
      return { url: info.thumburl, page: info.descriptionurl };
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resume from an existing photos.json so 429'd entries can be retried.
let out = {};
try {
  const { readFileSync } = await import('node:fs');
  out = JSON.parse(readFileSync('photos.json', 'utf8'));
} catch {
  // no previous run — start fresh
}

for (const [id, query] of Object.entries(QUERIES)) {
  if (out[id]?.url) continue;
  try {
    const photo = await findPhoto(query);
    out[id] = photo;
    console.error(`${photo ? 'ok  ' : 'MISS'} ${id} <- ${query}`);
  } catch (err) {
    console.error(`FAIL ${id}: ${err.message}`);
    out[id] = out[id] ?? null;
  }
  await sleep(6000);
}
console.log(JSON.stringify(out, null, 2));
