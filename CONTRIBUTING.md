# Contributing to EPUB Player

Thanks for your interest in contributing! This project is open source and welcomes contributions of all kinds.

## Ways to Contribute

- 🐛 **Report bugs** — Found something broken? Open an issue
- 💡 **Suggest features** — Have an idea? Start a discussion
- 📝 **Improve docs** — Typos, clarifications, examples
- 🔧 **Submit code** — Bug fixes, features, optimizations

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/epubplayer.git
cd epubplayer

# Install dependencies
npm install

# Start development server
npm run dev
```

### Development Commands

```bash
npm run dev          # Start dev server
npm run typecheck    # TypeScript check
npm run lint         # ESLint
npm run format       # Prettier
npm run test         # Unit tests
npm run test:e2e     # E2E tests (Playwright)
```

## Submitting Changes

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Make Your Changes

- Follow existing code style
- Add tests if applicable
- Update documentation if needed

### 3. Verify Your Changes

```bash
npm run typecheck    # Must pass
npm run lint         # Must pass
npm run test         # Should pass
```

### 4. Commit

Write clear, concise commit messages:

```
feat: add sleep timer end-of-chapter option
fix: resolve audio playback stutter on iOS Safari
docs: clarify WebGPU requirements in README
```

### 5. Push and Open a PR

```bash
git push origin your-branch-name
```

Then open a Pull Request on GitHub. Describe:
- What the change does
- Why it's needed
- Any testing you've done

## Code Style

- **TypeScript** — Strict mode, explicit types where helpful
- **React** — Functional components, hooks
- **Formatting** — Prettier handles it (`npm run format`)
- **Imports** — Use `@/` alias for `src/` imports

## Architecture Notes

Before making significant changes, review:
- [Architecture Overview](docs/architecture.md)
- [Architecture Decision Records](docs/decisions/)

If your change affects architecture, consider whether an ADR is warranted.

## Questions?

- Open a [GitHub Discussion](https://github.com/grworg/epubplayer/discussions) for questions
- Check existing issues before opening a new one

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

