// Мобильный кадр экрана входа: iPhone-подобный viewport (390×844, DPR 2).
import { chromium } from "playwright"
const browser = await chromium.launch({ args: ["--disable-gpu"] })
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)))
  await page.goto("http://localhost:3100/login", { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector("form", { timeout: 30000 })
  const aurora = await page.evaluate(() => {
    const c = document.querySelector("canvas")
    return c ? { w: c.clientWidth, h: c.clientHeight } : null
  })
  console.log("canvas видимый размер:", JSON.stringify(aurora))
  await page.screenshot({ path: "/home/user/work/visual-login-mobile.png" })
  console.log("ошибки страницы:", errors.length ? errors.join(" | ") : "нет")
  await page.close()
} finally {
  await browser.close()
}
