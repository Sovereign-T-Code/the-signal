# The Signal — Project Status & Reference

**Last updated**: March 23, 2026
**Status**: Production — live and auto-generating daily

---

## What This Is

A fully automated daily briefing site that covers AI model advancements, humanoid robotics, and their implications for public markets. Every morning, a GitHub Actions workflow runs a script that fetches RSS news, calls Claude Opus 4.6 with web search, pulls live stock data, generates a styled HTML page, deploys it to GitHub Pages, and emails a notification.

**Live site**: https://sovereign-t-code.github.io/the-signal/
**Repo**: https://github.com/Sovereign-T-Code/the-signal

---

## How It Works (The Pipeline)

```
Every day at 9:35 AM EST, GitHub Actions:
  1. Fetches RSS headlines from 8 news sources (last 36 hours)
  2. Sends headlines + prompt to Claude Opus 4.6 (with web search enabled)
  3. Claude researches, writes the edition (5 stories, quick hits, analysis, AGI tracker)
  4. Script parses Claude's structured output into sections
  5. Pulls live stock prices from Yahoo Finance spark API
  6. Injects everything into the HTML template
  7. Saves to docs/ folder, commits, pushes
  8. GitHub Pages auto-deploys
  9. Sends email notification to tereldaley@gmail.com
```

---

## Project Structure

```
The Signal/
├── .github/workflows/
│   └── daily.yml              # GitHub Actions: cron schedule + email notification
├── scripts/
│   └── generate.js            # Main generation script (~900 lines)
├── src/
│   ├── template.html          # HTML template with full CSS design system
│   ├── prompt.md              # System prompt that tells Claude how to write
│   └── watchlist.json         # RSS feeds, stock tickers, topics, companies to track
├── docs/                      # GitHub Pages serves from here
│   ├── index.html             # Always points to latest edition
│   ├── archive.html           # List of all past editions
│   ├── .nojekyll              # Tells GitHub Pages not to process with Jekyll
│   └── editions/
│       └── 2026-03-23.html    # One file per day (YYYY-MM-DD.html)
├── .env                       # Local API key (NOT in git)
├── .gitignore
├── package.json
├── package-lock.json
├── the-signal-claude-code-brief.md   # Original build spec
└── PROJECT-STATUS.md          # This file
```

---

## Key Files Explained

### `scripts/generate.js`
The brain of the operation. Does everything:
- **RSS fetching**: Pulls from 8 feeds, deduplicates, sorts by recency, keeps top 30 headlines
- **Claude API call**: Sends system prompt + headlines + watchlist context, uses `claude-opus-4-6` with `web_search_20250305` tool (15 max searches)
- **Response parser**: Extracts sections (LEAD-IN, STORIES, QUICK HITS, THE BIGGER PICTURE, AGI TRACKER) using regex on `## SECTION_NAME` headers
- **Visual renderer**: Parses `[VISUAL: type=X]` blocks from Claude's output and renders them as inline HTML (benchmark bars, timelines, comparison tables)
- **Stock data**: Uses Yahoo Finance v8 spark API (`query1.finance.yahoo.com/v8/finance/spark`) — single batch request, no rate limiting issues
- **HTML builder**: Replaces `{{PLACEHOLDER}}` tags in the template with rendered content
- **Duplicate guard**: Skips if today's edition already exists

### `src/template.html`
The complete design — dark theme, orange accents, fully responsive. Contains:
- Market Pulse ticker bar (scrollable stock chips)
- Category-tagged story cards (Models=orange, Robotics=green, Business=blue, Research=purple, Policy=pink)
- Sector Heatmap (color-coded grid of stock cards)
- Quick Hits section
- "The Bigger Picture" analysis block (orange left border)
- AGI Progress Tracker (4 animated progress bars)
- Inline visual styles (benchmark bars, timelines, comparison tables)
- "Past Editions" nav link in header

### `src/prompt.md`
Tells Claude exactly how to write each edition. Key rules:
- Must use specific section headers (`## LEAD-IN`, `## STORIES`, etc.)
- Stories tagged with `[CATEGORY: X]` before each `### headline`
- Must include "Why it matters" and "Market" notes per story
- Must include at least one inline visual per edition using `[VISUAL: type=X]` format
- AGI Tracker uses `Reasoning: 62% — explanation` format
- Only covers last 24 hours, never fabricates news

### `src/watchlist.json`
Configuration for what to track:
- **watchlist**: 8 public tickers (NVDA, GOOG, TSLA, MSFT, META, ARM, AMD, INTC)
- **private_companies_to_track**: Anthropic, OpenAI, Figure AI, 1X, Apptronik, Boston Dynamics, Mistral, xAI
- **rss_feeds**: 8 sources (Google News AI, TechCrunch AI, The Verge AI, Ars Technica, Reuters Tech, MIT Tech Review, VentureBeat AI, IEEE Spectrum Robotics)
- **topics**: AI models, humanoid robotics, embodied AI, AI infrastructure, regulation

### `.github/workflows/daily.yml`
GitHub Actions workflow:
- **Trigger**: Cron at `35 13 * * *` (9:35 AM EST) + manual via `workflow_dispatch`
- **Node version**: 20 (specified in workflow — local machine runs v24, both work)
- **Email**: Uses `dawidd6/action-send-mail@v3` with Gmail SMTP
- **Commit**: Auto-commits as "The Signal Bot" with message "Edition: YYYY-MM-DD"

---

## Secrets & Environment Variables

### GitHub Repo Secrets (Settings > Secrets > Actions)
| Secret | What it is |
|--------|-----------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` — Claude API key |
| `GMAIL_USERNAME` | `tereldaley@gmail.com` |
| `GMAIL_APP_PASSWORD` | 16-character Gmail app password |

### Local `.env` file (for testing locally)
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

---

## Common Tasks

### Run locally to test
```bash
cd "C:\Users\Terel\Claude Managed Projects\The Signal"
node scripts/generate.js
```
This makes a real API call (~$0.10-0.30). Output goes to `docs/editions/YYYY-MM-DD.html`.

### Force re-generate today's edition
Delete the existing file first (the script has a duplicate guard):
```bash
del docs\editions\2026-03-23.html
node scripts/generate.js
```

### Trigger a manual run on GitHub
Go to: GitHub repo > **Actions** tab > "Generate Daily Signal" > **Run workflow**

### Add/remove tracked stocks
Edit `src/watchlist.json` > `watchlist` array. Each entry needs:
```json
{ "ticker": "AAPL", "name": "Apple", "why": "Reason to track this stock" }
```

### Add/remove RSS feeds
Edit `src/watchlist.json` > `rss_feeds` array. Each entry needs:
```json
{ "name": "Source Name", "url": "https://example.com/rss" }
```

### Change the daily schedule
Edit `.github/workflows/daily.yml` > `cron` value. Format is `minute hour * * *` in UTC.
Current: `35 13 * * *` = 1:35 PM UTC = 9:35 AM EST.

### Change how Claude writes
Edit `src/prompt.md`. This is the system prompt sent to Claude every run. Changes here affect tone, structure, and what gets covered.

### Change the visual design
Edit `src/template.html`. All CSS is inline in the `<style>` block. Color variables are in `:root`.

---

## Known Issues & Quirks

1. **Yahoo Finance rate limiting**: The original `yahoo-finance2` npm package gets 429'd by Yahoo's anti-scraping. We bypassed it with direct calls to Yahoo's v8 spark API (`query1.finance.yahoo.com/v8/finance/spark?symbols=X,Y,Z`). The npm package is still in `package.json` as a fallback but rarely works.

2. **RSS feed failures**: One feed (Reuters) returns 404. The script handles this gracefully — logs a warning, continues with the other 7. Feeds may need updating over time as URLs change.

3. **Claude's visual output is inconsistent**: The prompt asks Claude to include `[VISUAL: type=X]` blocks, but Claude doesn't always produce them. The renderers are built and ready — they work when Claude includes the data. This could be improved by making the prompt even more explicit or adding examples.

4. **Node deprecation warnings**: Node v24 shows warnings about `punycode` and `url.parse()`. These come from the `rss-parser` dependency and are cosmetic — everything works fine.

5. **Stock data on weekends**: The spark API returns Friday's closing prices on Saturday/Sunday. The heatmap and ticker bar will show data, but change percentages reflect Thursday→Friday movement.

6. **Folder name sensitivity**: The project folder is `C:\Users\Terel\Claude Managed Projects\The Signal`. If you rename it, Claude Code sessions that reference the old path will break. Just start a new session in the new location.

---

## Architecture Decisions

- **No frameworks**: Pure HTML/CSS/JS. No React, no build step. The template is a single HTML file with inline styles.
- **GitHub Pages from `/docs`**: Configured in repo Settings > Pages > Deploy from branch > `master` > `/docs`.
- **One file per edition**: Each day creates `docs/editions/YYYY-MM-DD.html`. The `docs/index.html` is always overwritten with the latest edition.
- **Claude Opus 4.6**: Using the most capable model for quality writing and accurate web search. Costs ~$0.10-0.30 per run.
- **Web search tool**: Claude gets up to 15 web searches per edition to verify and enrich RSS headlines with real data.

---

## Commit History

```
0fcb3a7 Add email notification when daily edition is published
bea0fc7 Add inline visuals, fix stock data, and improve template
ea26bb3 Rename site/ to docs/ for GitHub Pages compatibility
70269f7 Fix dotenv override and add first generated edition
4bcee3b Initial commit: The Signal - daily AI/robotics briefing
```

---

## What Could Be Improved Next

- **Visual consistency**: Fine-tune the prompt or add a post-processing step to ensure at least one visual per edition
- **Custom domain**: Point a real domain (e.g., thesignal.ai) at GitHub Pages
- **RSS feed health monitoring**: Auto-detect dead feeds and swap them out
- **Historical stock charts**: Use spark API's range parameter to show multi-day trends
- **Edition diffing**: Compare today's tracker percentages to yesterday's and show arrows
- **RSS → email digest**: Send the full edition as an email, not just a notification link
