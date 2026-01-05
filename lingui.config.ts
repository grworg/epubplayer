import type { LinguiConfig } from '@lingui/conf'

const config: LinguiConfig = {
  locales: ['en', 'es', 'fr', 'de', 'pt', 'zh'],
  sourceLocale: 'en',
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['src'],
    },
  ],
  format: 'po',
  // Compile to TypeScript with explicit messages
  compileNamespace: 'ts',
}

export default config

