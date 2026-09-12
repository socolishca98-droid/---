// test-ati.mjs
const TOKEN = '15e69c8cf7234414803510bb85ead015';
const CLIENT_ID = 'c486aeb26e314ce19d02fc1fd36f7d39';

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

const browserHeaders = {
  'Authorization': `Bearer ${TOKEN}`,
  'Cookie': `sid=${TOKEN};`,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
  'Referer': 'https://loads.ati.su/',
  'Origin': 'https://loads.ati.su',
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

async function test(name, url, options) {
  console.log(`\n--- ${name} ---`);
  console.log(`URL: ${url}`);
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${text.slice(0, 500)}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

async function main() {
  console.log('========== ТЕСТ ATI.SU API ==========\n');

  // Тест 1: Поиск грузов (основной)
  await test('Loads Search',
    'https://loads.ati.su/webapi/v1.0/loads/search',
    { 
      method: 'POST', 
      headers: browserHeaders, 
      body: JSON.stringify({
        page: 1,
        items_per_page: 3,
        filter: {
          from: { id: 1, type: 2 },
          dates: { date_option: 'today-plus' }
        }
      })
    }
  );

  // Тест 2: Geo (старый)
  await test('Geo Suggestion',
    'https://loads.ati.su/webapi/v1.0/dictionaries/geo/suggestion',
    { method: 'POST', headers: browserHeaders, body: JSON.stringify({ text: 'Москва' }) }
  );

  // Тест 3: API v2
  await test('API v2 Geo',
    'https://api.ati.su/v2/geo/cities?query=Москва',
    { method: 'GET', headers }
  );

  // Тест 4: Dictionaries
  await test('Dictionaries',
    'https://api.ati.su/v1.0/dictionaries/cities?query=Москва',
    { method: 'GET', headers }
  );

  console.log('\n========== ГОТОВО ==========');
}

main();