# The Signal — Build this project

You are building a fully automated daily blog called "The Signal" that tracks AI model advancements, humanoid robotics, and what it all means for public markets. Every morning, a script runs, calls the Claude API with web search, fetches stock data, and generates a beautifully designed HTML page that auto-deploys to a static site.

Do not overcomplicate this. This is a static site. No frameworks. No React. No Next.js. One script, one HTML template, one config file. That's the whole thing.

Start with the project structure, then the generation script, then the HTML template. Let me test locally before we set up GitHub Actions.

---

## Architecture

```
GitHub Actions (cron, 7am EST daily)
  → runs generate.js (or generate.py — pick one, stay consistent)
    → fetches stock prices from yfinance / Yahoo Finance (free, no key)
    → calls Claude API (Opus 4.6) with web search enabled
    → Claude searches for latest AI/robotics news, writes the edition
    → script parses Claude's response, injects into HTML template
    → commits new page to repo
  → Vercel/Netlify auto-deploys on push
  → (optional) sends notification email via Resend
```

---

## Tech stack

- **Language**: Node.js preferred, Python acceptable — pick one and stay consistent
- **Claude API**: Use Opus 4.6 (`claude-opus-4-6`) with web search tool enabled
- **Stock data**: `yahoo-finance2` npm package or `yfinance` Python library (both free, no API key needed)
- **Hosting**: Static site on Vercel or Netlify (free tier)
- **Scheduling**: GitHub Actions with cron trigger
- **Email (optional)**: Resend free tier (100 emails/day)
- **No database** — each day's edition is a standalone HTML file

---

## Project structure

```
the-signal/
├── .github/
│   └── workflows/
│       └── daily.yml          # GitHub Actions cron job
├── scripts/
│   └── generate.js            # Main generation script
├── src/
│   ├── template.html          # HTML template with placeholder tokens
│   ├── prompt.md              # System prompt for Claude
│   └── watchlist.json         # Ticker watchlist + topic config
├── site/
│   ├── index.html             # Always points to latest edition
│   ├── archive.html           # List of all past editions
│   └── editions/
│       └── 2026-03-22.html    # Each day gets its own file
├── package.json
└── README.md
```

---

## Step 1: The watchlist config (src/watchlist.json)

This defines what I care about. The script reads it and passes it to Claude as context.

```json
{
  "topics": [
    "AI model releases and benchmark results",
    "Humanoid robotics development and deployment",
    "AGI progress and research breakthroughs",
    "Robotics entering homes and consumer spaces"
  ],
  "watchlist": [
    { "ticker": "NVDA", "name": "Nvidia", "why": "AI chips, robotics inference silicon" },
    { "ticker": "GOOG", "name": "Alphabet", "why": "DeepMind, Gemini models" },
    { "ticker": "TSLA", "name": "Tesla", "why": "Optimus humanoid robot" },
    { "ticker": "MSFT", "name": "Microsoft", "why": "OpenAI partnership, Azure AI" },
    { "ticker": "META", "name": "Meta", "why": "Llama models, AI research" },
    { "ticker": "ARM", "name": "Arm Holdings", "why": "Chip architecture for edge AI" },
    { "ticker": "AMD", "name": "AMD", "why": "AI accelerators, competition with Nvidia" },
    { "ticker": "INTC", "name": "Intel", "why": "AI chip efforts, foundry" }
  ],
  "private_companies_to_track": [
    "Anthropic", "OpenAI", "Figure AI", "1X Technologies",
    "Apptronik", "Boston Dynamics", "Mistral AI", "xAI"
  ]
}
```

---

## Step 2: The system prompt (src/prompt.md)

Store this as a file so it is easy to edit the editorial voice without touching code. This is what gets sent to the Claude API as the system prompt.

```markdown
You are the editor of "The Signal," a daily AI and robotics briefing with a financial lens. Your reader is someone who tracks AGI development and humanoid robots entering homes, and wants to understand what each development means for public markets.

## Your job each day

1. Search the web for the most important AI and robotics developments from the past 24 hours
2. Write today's edition of The Signal

## Structure of each edition

### Opening
- Write a 1-2 sentence italic lead-in that sets the tone for the day. Be direct, slightly opinionated, and never boring.

### Main stories (3-5)
For each story:
- Assign a category tag: "Models", "Robotics", "Business", "Research", or "Policy"
- Write a compelling headline
- Write 2-4 sentences covering what happened
- Write a "Why it matters" line connecting this to the bigger AGI/robotics picture
- Write a "Market" note connecting this to specific public tickers. Include the ticker symbol and any relevant price movement or analyst commentary you find. If the company is private, note that and mention the nearest public proxy plays.
- IMPORTANT: Where appropriate, include data for an inline visual. You can suggest:
  - A benchmark comparison (horizontal bar chart) when comparing model scores
  - A timeline when showing progress toward a milestone
  - A mini stock chart annotation when a catalyst event moved a stock
  - A comparison table when contrasting products or approaches

For suggested visuals, output them in this exact format so the template can parse them:

[VISUAL: type=benchmark_bars]
[DATA: Gemini 3.5=82.4, Claude Opus 4.6=68.8, GPT-5.4=65.1]
[LABEL: ARC-AGI benchmark scores]

[VISUAL: type=timeline]
[DATA: 2024|Figure 01|Lab only, 2025|Figure 02|Warehouse, 2026|Figure 03|FDA cleared, 2027?|Mass market|Consumer sales]
[HIGHLIGHT: 2026]
[LABEL: Humanoid robots → home timeline]

### Sector heatmap
Using the stock data provided in context, note the weekly performance direction for each ticker so the template can render the heatmap grid.

### Quick hits (2-4)
Shorter items that don't need a full story. One line each. Include company name and ticker/private status.

### The bigger picture
A paragraph (4-6 sentences) that connects today's stories into a broader narrative about where AGI and robotics are heading. This should read like the closing thought from a sharp analyst — connecting dots, not just summarizing. End with a forward-looking insight or question.

### AGI progress tracker
Update these four dimensions with a percentage (0-100) and a one-line explanation of what changed this week:
- Reasoning (how close are models to general reasoning)
- Autonomy (how independently can AI agents operate)
- Embodiment (how capable are physical robots)
- In-home (how close are robots to being in consumer homes)

## Tone
- Direct and confident, never breathless or hype-y
- Like a smart friend who reads everything and gives you the important bits
- Slightly opinionated in the bigger picture section
- Never say "AI is moving fast" or other clichés
- Financial observations are informational, not advice

## Important rules
- Only report things you actually find via web search. Never fabricate news.
- If it is a slow news day, say so. Do not inflate minor items.
- Always include a disclaimer that this is not financial advice.
- Use real numbers when you can find them (benchmark scores, funding amounts, stock prices).
```

---

## Step 3: The generation script (scripts/generate.js)

This is the core. Here is exactly what it does:

1. Read `src/watchlist.json`
2. Fetch stock data for each ticker in the watchlist:
   - Previous close, daily change %, weekly change %, current price
   - Use `yahoo-finance2` npm package (free, no API key)
   - Add retry logic with backoff — Yahoo Finance can be flaky
   - If stock data fails, still generate the edition but note market data is unavailable
3. Read `src/prompt.md` (the system prompt)
4. Build the user message containing:
   - Today's date
   - All fetched stock data as structured context
   - The topics and watchlist from the config
   - The instruction: "Write today's edition of The Signal"
5. Call the Claude API:
   - Model: `claude-opus-4-6`
   - System prompt: contents of prompt.md
   - Tools: web_search with max_uses of 10 to 15
   - Max tokens: 8192
6. Parse Claude's response:
   - The API response with web search contains multiple content blocks interleaved (text, tool_use, tool_result). Extract all blocks where `type === "text"` and concatenate them. That is the written content.
   - Parse structured sections from the text (lead-in, stories, quick hits, bigger picture, tracker)
   - Parse any `[VISUAL: ...]` blocks into data structures for SVG rendering
   - Parse the AGI tracker percentages
7. Inject everything into the HTML template (`src/template.html`)
8. Save the result to `site/editions/YYYY-MM-DD.html`
9. Update `site/index.html` to point to today's edition
10. Update `site/archive.html` with the new entry

Here is the key API call configuration:

```javascript
const response = await anthropic.messages.create({
  model: "claude-opus-4-6",
  max_tokens: 8192,
  system: systemPrompt,
  tools: [{
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 15
  }],
  messages: [{
    role: "user",
    content: userMessage
  }]
});

// Extract written content from response
const textContent = response.content
  .filter(block => block.type === "text")
  .map(block => block.text)
  .join("\n");
```

Important: install the Anthropic SDK with `npm install @anthropic-ai/sdk`.

---

## Step 4: The HTML template (src/template.html)

This is the most important file. The template determines the entire visual experience. Build it with placeholder tokens that the generation script replaces. Spend real time making this look right.

### Design system — follow this exactly

**Colors:**
- Background: `#1a1814`
- Primary text: `#f0ece4`
- Body text: `#e8e4dc`
- Secondary text: `#9e9888`
- Muted text: `#8a8578`
- Dim text: `#6b665c`
- Faint text: `#5a564e`
- Orange accent: `#e89650`
- Green (positive/up): `#7aab6e`
- Red (negative/down): `#c75c5c`
- Blue (market tag): `#6b9ec4`
- Purple (research tag): `#b088d0`
- Pink (policy tag): `#c4697a`
- Subtle borders: `rgba(232,150,80,0.2)` (orange tinted)
- Card backgrounds: `rgba(255,255,255,0.02)` to `rgba(255,255,255,0.03)`
- Dividers between stories: `linear-gradient(90deg, transparent, rgba(232,150,80,0.15), transparent)`

**Typography:**
- Body font: system sans-serif stack, or load Inter from Google Fonts
- Serif font (for lead-in and bigger picture): system serif stack, or load Lora or Newsreader
- "THE SIGNAL" logo text: 11px, letter-spacing 3px, uppercase, orange
- Tagline below logo: 22px, weight 500, primary text color
- Story headlines: 17px, weight 500, primary text color
- Body paragraphs: 14px, weight 400, line-height 1.65, secondary text color
- Category tags: 11px, weight 500, dark text (#1a1814) on colored pill background, border-radius 4px, padding 2px 8px
- "Why it matters →" lines: 12px, orange, opacity 0.7
- Market note cards: 13px text in a subtle card (rgba white background), with a blue "MARKET" label (11px, weight 500, letter-spacing 1px)
- Quick hit items: 13.5px, company name in lighter color (#c4bfb4)
- Disclaimer: 11px, faint text
- Footer: 11px, dim text

**Category tag background colors:**
- Models → `#e89650` (orange)
- Robotics → `#7aab6e` (green)
- Business → `#6b9ec4` (blue)
- Research → `#b088d0` (purple)
- Policy → `#c4697a` (pink)

**Layout — this is the order of elements in the page:**

1. **Header**: "THE SIGNAL" logo left, date right. Border-bottom in subtle orange.
2. **Market pulse bar**: Horizontal row of watchlist tickers with daily % change. Green for positive, red for negative. Contained in a subtle card. Horizontal scrolling on mobile.
3. **Lead-in**: 1-2 sentence italic paragraph in serif font. Color #b8b2a6.
4. **Stories**: Each story contains:
   - Category tag pill + headline on the same line (flex, baseline aligned)
   - Body paragraph
   - "Why it matters →" line
   - Market note card
   - Optional inline visual (SVG chart, see below)
   - Gradient divider between stories
5. **Sector heatmap**: A CSS grid (4 columns) of ticker cards. Each card shows ticker name, weekly % change, and price. Background tint is green or red with intensity proportional to magnitude.
6. **Quick hits**: Simple list with subtle bottom borders between items.
7. **The bigger picture**: Orange left border (3px solid #e89650), slight background tint, serif text, border-radius 0 8px 8px 0.
8. **AGI progress tracker**: Four horizontal progress bars (Reasoning, Autonomy, Embodiment, In-home). Each bar has a label, a filled bar on a dark track, and a percentage. Colors: orange for Reasoning, blue for Autonomy, green for Embodiment, pink for In-home. Include a short note below about what changed.
9. **Disclaimer**: "Not financial advice" text in a subtle card.
10. **Footer**: "Written by Claude · Curated for you" on the left, "thesignal.ai" on the right.

### Inline visual rendering

The generation script parses `[VISUAL]` blocks from Claude's output and converts them to SVG. Build rendering functions for each visual type:

**benchmark_bars** — Horizontal SVG bar chart:
- Orange fill (#e89650, opacity 0.9) for the top scorer, gray fill (#8a8578, opacity 0.6) for the rest, even dimmer gray (opacity 0.35) for the lowest
- Labels left-aligned, percentage values right of each bar
- Contained in a card with rgba(255,255,255,0.02) background, border-radius 8px, padding 16px
- Uppercase label above (11px, letter-spacing 1.5px, dim text)

**timeline** — SVG horizontal timeline:
- Horizontal line connecting dots
- Past dots: filled gray circles with gray stroke
- Highlighted dot (current): larger, filled orange
- Future dots: dashed stroke, hollow
- "WE ARE HERE" label above the highlighted dot in orange, 10px
- Labels below each dot: year, name, and description
- Same card container as benchmark_bars

**stock_chart** — SVG area chart:
- Polyline for the price path, area fill below with gradient (color to transparent)
- Green for uptrend, red for downtrend
- Horizontal dashed grid lines with price labels on the right
- Optional vertical dashed line for catalyst events with a label below
- Price and daily % change displayed in the top right of the card
- Same card container

**heatmap** — CSS grid (already described in the sector heatmap section above, not SVG)

All visuals are pure SVG and HTML. No JavaScript charting libraries needed. The generation script builds the SVG strings and injects them into the template.

---

## Step 5: GitHub Actions workflow (.github/workflows/daily.yml)

```yaml
name: Generate Daily Signal
on:
  schedule:
    - cron: '0 12 * * *'  # Noon UTC = 7am EST / 8am EDT
  workflow_dispatch:  # Manual trigger for testing

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - run: node scripts/generate.js
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Commit and push
        run: |
          git config user.name "The Signal Bot"
          git config user.email "bot@thesignal.ai"
          git add site/
          git commit -m "Edition: $(date +%Y-%m-%d)" || echo "No changes"
          git push
```

The `ANTHROPIC_API_KEY` must be stored in the repo's GitHub Secrets (Settings → Secrets → Actions → New secret).

---

## Step 6: Deployment

Connect the GitHub repo to Vercel or Netlify:
- Set the publish directory to `site/`
- It auto-deploys on every push to main
- `site/index.html` always redirects to or embeds the latest edition
- `site/archive.html` lists all past editions with dates and headlines
- No build step needed — it is all static HTML

---

## Step 7: Optional email notification

After generating the HTML, optionally send a short email via Resend:

```javascript
await resend.emails.send({
  from: 'The Signal <signal@yourdomain.com>',
  to: 'you@email.com',
  subject: `The Signal — ${today}`,
  html: `
    <p>Today's edition is ready.</p>
    <p><a href="https://thesignal.ai/editions/${today}.html">Read The Signal →</a></p>
    <p style="color: #888; font-size: 12px;">${leadIn}</p>
  `
});
```

Only implement this if I ask for it. Focus on the core first.

---

## Implementation notes

1. **Response parsing is critical.** The Claude API response with web search contains interleaved content blocks: text, tool_use, and tool_result. Extract all `type: "text"` blocks and concatenate them. That is the written edition. Do not try to use the tool_use or tool_result blocks directly.

2. **Handle slow news days.** The template must look good with only 1-2 stories. Do not break the layout if Claude writes fewer stories than expected.

3. **Error handling.** If the API call fails or stock fetch fails, log the error. Do not deploy a broken page. If stock data fails, still generate the edition with a note that market data was unavailable.

4. **The [VISUAL] parsing can be a second pass.** Get the text content rendering properly first. Then add visual parsing. Do not block the first working version on visual rendering.

5. **Test locally first.** The script must work when I run `node scripts/generate.js` locally before we touch GitHub Actions. Use a `.env` file (gitignored) with `ANTHROPIC_API_KEY=sk-...` for local development. Use the `dotenv` package.

6. **The archive matters.** Over time it becomes valuable — I want to see how the AGI tracker changed over months. Make sure each edition is a clean standalone HTML file that works if opened directly.

7. **Max width.** The content area of the blog should be max 660px, centered, with the dark background extending full width.

8. **Mobile friendly.** The layout should work on mobile. The market pulse bar should scroll horizontally. The heatmap grid should stack to 2 columns on small screens.

---

## What "done" looks like

- I run `node scripts/generate.js` locally and it produces a beautiful HTML page in `site/editions/`
- The page contains real news from today found via Claude's web search
- The page contains real stock data fetched from Yahoo Finance
- The page includes at least one inline SVG visual
- The design matches the dark/warm/orange aesthetic described in the design system above
- GitHub Actions runs it automatically every morning
- The site auto-deploys to Vercel or Netlify
- Total cost: approximately $3-5 per month in Claude API usage, $0 for hosting

Start building now. Begin with the project structure and package.json, then the generation script, then the HTML template.
