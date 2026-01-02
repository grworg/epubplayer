import fs from 'node:fs/promises'
import path from 'node:path'

// All public, indexable routes
const routes = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },           // Landing page
  { path: '/app', priority: '0.9', changefreq: 'weekly' },        // Main app (library)
  { path: '/app/help', priority: '0.7', changefreq: 'monthly' },  // Help page
  { path: '/app/terms', priority: '0.5', changefreq: 'yearly' },  // Terms/Privacy
  { path: '/app/settings', priority: '0.6', changefreq: 'monthly' }, // Settings
]

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
    const loc = `${base}${r.path === '/' ? '/' : r.path}`
    return `  <url>
    <loc>${loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`
  })
  .join('\n')

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlset}
</urlset>
`

const outFile = path.join(process.cwd(), 'public', 'sitemap.xml')
await fs.writeFile(outFile, xml, 'utf8')
console.log(`[sitemap] wrote ${outFile} (${routes.length} routes)`)


