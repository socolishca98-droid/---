const urls = [
  'http://localhost:3000/api/ati/cache?stats=true',
  'http://localhost:3000/api/ati/geo?q=москва',
  'http://localhost:3000/api/ati/sandbox'
]

for (const url of urls) {
  try {
    const res = await fetch(url)
    const text = await res.text()
    console.log(`\n=== ${url} ===`)
    console.log('Status:', res.status)
    console.log('Body:', text.substring(0, 500))
  } catch (e) {
    console.error(`Error fetching ${url}:`, e.message)
  }
}
