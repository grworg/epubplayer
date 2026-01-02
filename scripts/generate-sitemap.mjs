import fs from 'node:fs/promises'
import path from 'node:path'

const routes = ['/', '/help', '/terms', '/settings']

const siteUrl =
  process.env.SITE_URL ||
  process.env.VITE_SITE_URL ||
  process.env.npm_package_homepage ||
  'http://localhost:5173'

if (!process.env.SITE_URL && !process.env.VITE_SITE_URL && !process.env.npm_package_homepage) {
  console.warn(
    `[sitemap] SITE_URL not set; defaulting to ${siteUrl}. For production SEO, run with SITE_URL=https://your-domain.com`
  )
}

const normalizeBase = (u) => u.replace(/\/+$/, '')
const base = normalizeBase(siteUrl)

const now = new Date().toISOString().slice(0, 10)

const urlset = routes
  .map((r) => {
    const loc = `${base}${r === '/' ? '/' : r}`
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${now}</lastmod>\n  </url>`
  })
  .join('\n')

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlset}\n</urlset>\n`

const outFile = path.join(process.cwd(), 'public', 'sitemap.xml')
await fs.writeFile(outFile, xml, 'utf8')
console.log(`[sitemap] wrote ${outFile} (${routes.length} routes)`)


