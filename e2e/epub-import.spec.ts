import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE_EPUB = path.join(__dirname, '../src/test/fixtures/sample.epub')

test.describe('EPUB Import & Playback', () => {
  test.beforeEach(async ({ page }) => {
    // Clear IndexedDB before each test
    await page.goto('/')
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('epub-player')
        req.onsuccess = () => resolve()
        req.onerror = () => resolve()
      })
    })
    await page.reload()
  })

  test('imports EPUB and extracts sections correctly', async ({ page }) => {
    await page.goto('/')
    
    // Should show empty library initially
    await expect(page.getByText('No books yet')).toBeVisible()
    
    // Upload EPUB
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_EPUB)
    
    // Wait for import to complete
    await page.waitForTimeout(5000)
    
    // Verify database has book with sections
    const dbInfo = await page.evaluate(() => {
      return new Promise((resolve) => {
        const req = indexedDB.open('epub-player')
        req.onsuccess = (e: Event) => {
          const db = (e.target as IDBOpenDBRequest).result
          const tx = db.transaction(['books', 'sections'], 'readonly')
          const booksReq = tx.objectStore('books').getAll()
          const sectionsReq = tx.objectStore('sections').getAll()
          
          booksReq.onsuccess = () => {
            sectionsReq.onsuccess = () => {
              const books = booksReq.result
              const sections = sectionsReq.result
              resolve({
                booksCount: books.length,
                bookTitle: books[0]?.title || null,
                sectionsCount: sections.length,
                sectionTitles: sections.slice(0, 5).map((s: { title: string }) => s.title),
                totalCharacters: sections.reduce((sum: number, s: { charCount: number }) => sum + s.charCount, 0),
              })
            }
          }
        }
        req.onerror = () => resolve({ error: 'DB open failed' })
      })
    })
    
    const info = dbInfo as {
      booksCount: number
      bookTitle: string
      sectionsCount: number
      sectionTitles: string[]
      totalCharacters: number
    }
    
    // Book was imported
    expect(info.booksCount).toBe(1)
    expect(info.bookTitle).toContain('Frankenstein')
    
    // Sections were extracted
    expect(info.sectionsCount).toBeGreaterThan(20) // Frankenstein has ~30 chapters
    expect(info.totalCharacters).toBeGreaterThan(100000) // Full novel has lots of text
    
    // Library should now show the book (not empty state)
    await expect(page.getByText('No books yet')).not.toBeVisible()
  })
})
