const ATI_TOKEN = "15e69c8cf7234414803510bb85ead015"

async function test() {
  console.log("FINAL TEST:", new Date().toLocaleString(), "\n")
  
  const body = {
    page: 1,
    items_per_page: 50,
    filter: {
      loading: {
        geo: { type: 1, list: [3611], radius: 500 }
      }
    },
    exclude_geo_dicts: true
  }
  
  const r = await fetch("https://loads.ati.su/webapi/v1.0/loads/search", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + ATI_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  })
  
  const d = await r.json()
  
  console.log("Status:", r.status)
  console.log("Total:", d.totalItems)
  console.log("Loads:", d.loads?.length)
  
  if (d.loads?.length > 0) {
    console.log("\n=== SUCCESS! ===")
    d.loads.slice(0,5).forEach((l,i) => {
      console.log(`${i+1}. ${l.loading?.location?.city} -> ${l.unloading?.location?.city}`)
    })
    require("fs").writeFileSync("success.json", JSON.stringify(d.loads, null, 2))
    console.log("\nSaved", d.loads.length, "loads to success.json")
  } else {
    console.log("\nStill 0. Try again in 1 hour (after 08:00 MSK)")
  }
}

test()