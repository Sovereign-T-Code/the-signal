require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;
const Parser = require('rss-parser');

// ============================================================
// Configuration
// ============================================================

const ROOT = path.resolve(__dirname, '..');
const EDITIONS_DIR = path.join(ROOT, 'docs', 'editions');
const TEMPLATE_PATH = path.join(ROOT, 'src', 'template.html');
const PROMPT_PATH = path.join(ROOT, 'src', 'prompt.md');
const WATCHLIST_PATH = path.join(ROOT, 'src', 'watchlist.json');
const INDEX_PATH = path.join(ROOT, 'docs', 'index.html');
const ARCHIVE_PATH = path.join(ROOT, 'docs', 'archive.html');

const now = new Date();
const today = now.toISOString().split('T')[0];
const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
}

// ============================================================
// Duplicate Guard
// ============================================================

const editionPath = path.join(EDITIONS_DIR, `${today}.html`);
if (fs.existsSync(editionPath)) {
  console.log(`Edition for ${today} already exists. Skipping.`);
  process.exit(0);
}

// ============================================================
// RSS News Fetching
// ============================================================

async function fetchRSSNews(feeds) {
  const parser = new Parser({ timeout: 10000 });
  const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const allItems = [];

  const results = await Promise.allSettled(
    feeds.map(feed =>
      parser.parseURL(feed.url)
        .then(parsed => ({ source: feed.name, items: parsed.items || [] }))
    )
  );

  let successCount = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      successCount++;
      for (const item of result.value.items) {
        const pubDate = item.pubDate ? new Date(item.pubDate) : null;
        if (!pubDate || pubDate >= cutoff) {
          allItems.push({
            title: (item.title || '').trim(),
            link: item.link || '',
            source: result.value.source,
            pubDate: pubDate ? pubDate.toISOString() : '',
            summary: (item.contentSnippet || '').substring(0, 200).trim()
          });
        }
      }
    } else {
      console.warn(`  RSS feed failed: ${result.reason?.message || 'unknown error'}`);
    }
  }
  console.log(`  ${successCount}/${feeds.length} feeds responded`);

  // Deduplicate by normalized title
  const seen = new Set();
  const unique = allItems.filter(item => {
    if (!item.title) return false;
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
  return unique.slice(0, 30);
}

// ============================================================
// Ticker Scanning
// ============================================================

function findMentionedTickers(text, watchlist) {
  return watchlist.filter(stock => {
    const regex = new RegExp(`\\b\\$?${stock.ticker}\\b`);
    return regex.test(text);
  });
}

// ============================================================
// Stock Data Fetching
// ============================================================

async function fetchStockData(tickers) {
  if (tickers.length === 0) return [];

  let yahooFinance;
  try {
    yahooFinance = require('yahoo-finance2').default;
  } catch (err) {
    console.warn('  yahoo-finance2 not available:', err.message);
    return [];
  }

  const results = [];
  for (const stock of tickers) {
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const quote = await yahooFinance.quote(stock.ticker);
        results.push({
          ticker: stock.ticker,
          name: stock.name,
          why: stock.why,
          price: quote.regularMarketPrice || 0,
          change: quote.regularMarketChange || 0,
          changePercent: quote.regularMarketChangePercent || 0,
          previousClose: quote.regularMarketPreviousClose || 0
        });
        success = true;
        break;
      } catch (err) {
        console.warn(`  Attempt ${attempt}/3 for ${stock.ticker}: ${err.message}`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
      }
    }
    if (!success) {
      console.warn(`  Failed to fetch ${stock.ticker} after 3 attempts`);
    }
  }
  return results;
}

// ============================================================
// Claude API Call
// ============================================================

async function callClaude(systemPrompt, newsHeadlines, watchlistConfig) {
  const anthropic = new Anthropic();

  const newsContext = newsHeadlines.length > 0
    ? `## Pre-researched news headlines (from RSS feeds, last 36 hours)
Use these as leads. Investigate the most important ones via web search for details, quotes, and numbers.

${newsHeadlines.map(item =>
  `- [${item.source}] ${item.title}${item.summary ? ` — ${item.summary}` : ''}`
).join('\n')}`
    : '## No RSS headlines available\nUse web search to discover today\'s AI and robotics news directly.';

  const userMessage = `Today's date: ${formatDate(today)} (${today})
Yesterday's date: ${yesterday}

IMPORTANT: Cover news from ${yesterday} through ${today} only. Do not resurface older stories.

${newsContext}

## Topics of interest
${watchlistConfig.topics.map(t => `- ${t}`).join('\n')}

## Public companies to watch (mention ticker symbols when relevant)
${watchlistConfig.watchlist.map(s => `- ${s.ticker} (${s.name}): ${s.why}`).join('\n')}

## Private companies to track
${watchlistConfig.private_companies_to_track.join(', ')}

Write today's edition of The Signal.`;

  console.log('Calling Claude API...');
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    system: systemPrompt,
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 15
    }],
    messages: [{ role: 'user', content: userMessage }]
  });

  const textContent = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  console.log(`  Response: ${textContent.length} chars, ${response.usage?.output_tokens || '?'} output tokens`);
  return textContent;
}

// ============================================================
// Response Parser
// ============================================================

function parseEdition(rawText) {
  const result = {
    leadIn: '',
    stories: [],
    quickHits: [],
    biggerPicture: '',
    tracker: []
  };

  try {
    const sections = parseSections(rawText);

    // Lead-in: strip surrounding markdown italic markers
    result.leadIn = (sections['LEAD-IN'] || '')
      .replace(/^\*+|\*+$/g, '')
      .replace(/^_+|_+$/g, '')
      .trim();

    // Stories
    if (sections['STORIES']) {
      result.stories = parseStories(sections['STORIES']);
    }

    // Quick hits
    if (sections['QUICK HITS']) {
      result.quickHits = sections['QUICK HITS']
        .split('\n')
        .map(line => line.replace(/^[-*•]\s*/, '').trim())
        .filter(line => line.length > 0 && !line.startsWith('['));
    }

    // Bigger picture: strip any visual blocks
    result.biggerPicture = stripVisualBlocks(sections['THE BIGGER PICTURE'] || '').trim();

    // AGI tracker
    if (sections['AGI TRACKER']) {
      result.tracker = parseTracker(sections['AGI TRACKER']);
    }
  } catch (err) {
    console.warn('  Parser error:', err.message);
  }

  return result;
}

function parseSections(rawText) {
  const sections = {};
  const headerNames = ['LEAD-IN', 'STORIES', 'QUICK HITS', 'THE BIGGER PICTURE', 'AGI TRACKER'];
  const headerRegex = /^##\s+(LEAD-IN|STORIES|QUICK HITS|THE BIGGER PICTURE|AGI TRACKER)\s*$/gmi;
  const matches = [...rawText.matchAll(headerRegex)];

  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1].toUpperCase();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
    sections[name] = rawText.substring(start, end).trim();
  }

  // Fallback: if no section headers found, try to extract what we can
  if (matches.length === 0 && rawText.length > 0) {
    console.warn('  No section headers found in Claude output. Using raw text as single story.');
    sections['STORIES'] = rawText;
  }

  return sections;
}

function parseStories(storiesText) {
  const stories = [];

  // Primary approach: match [CATEGORY: X] followed by ### headline
  const storyRegex = /\[CATEGORY:\s*(\w+)\]\s*\n###\s+(.+)\n([\s\S]*?)(?=\[CATEGORY:|$)/gi;
  let match;

  while ((match = storyRegex.exec(storiesText)) !== null) {
    const story = extractStoryParts(match[1], match[2].trim(), match[3]);
    if (story) stories.push(story);
  }

  // Fallback: if primary regex didn't match, split on ### headers
  if (stories.length === 0 && storiesText.includes('###')) {
    const parts = storiesText.split(/(?=###\s)/);
    for (const part of parts) {
      const headlineMatch = part.match(/###\s+(.+)/);
      if (!headlineMatch) continue;

      // Try to find category tag nearby
      const catMatch = part.match(/\[CATEGORY:\s*(\w+)\]/i);
      const category = catMatch ? catMatch[1] : 'Business';
      const content = part.replace(/###.*\n/, '').replace(/\[CATEGORY:[^\]]+\]\s*/gi, '');

      const story = extractStoryParts(category, headlineMatch[1].trim(), content);
      if (story) stories.push(story);
    }
  }

  return stories;
}

function extractStoryParts(category, headline, content) {
  content = stripVisualBlocks(content);

  let body = '', whyItMatters = '', market = '';

  // Find "Why it matters" line
  const whyMatch = content.match(/\*?\*?Why it matters\*?\*?\s*:?\s*→?\s*(.+?)(?=\n\s*\*?\*?Market|$)/is);
  if (whyMatch) whyItMatters = whyMatch[1].trim();

  // Find "Market" note
  const marketMatch = content.match(/\*?\*?Market\*?\*?\s*:?\s*→?\s*([\s\S]+?)$/i);
  if (marketMatch) market = marketMatch[1].trim();

  // Body is everything before "Why it matters" (or before "Market" if no "why")
  const whyIdx = content.search(/\*?\*?Why it matters/i);
  const marketIdx = content.search(/\*?\*?Market\*?\*?\s*:/i);

  if (whyIdx > 0) {
    body = content.substring(0, whyIdx).trim();
  } else if (marketIdx > 0) {
    body = content.substring(0, marketIdx).trim();
  } else {
    body = content.trim();
  }

  // Clean up any remaining category tags from body
  body = body.replace(/\[CATEGORY:[^\]]+\]\s*/gi, '').trim();

  if (!headline) return null;
  return { category, headline, body, whyItMatters, market };
}

function parseTracker(text) {
  const dimensions = [
    { key: 'reasoning', label: 'Reasoning', color: '#e89650' },
    { key: 'autonomy', label: 'Autonomy', color: '#6b9ec4' },
    { key: 'embodiment', label: 'Embodiment', color: '#7aab6e' },
    { key: 'in-home', label: 'In-home', color: '#c4697a' }
  ];

  return dimensions.map(dim => {
    const regex = new RegExp(`${dim.label}:\\s*(\\d+)%\\s*[—–\\-]\\s*(.+?)(?=\\n|$)`, 'i');
    const match = text.match(regex);
    return {
      ...dim,
      percent: match ? parseInt(match[1]) : 0,
      note: match ? match[2].trim() : 'No update this week'
    };
  });
}

function stripVisualBlocks(text) {
  return text
    .replace(/\[VISUAL[^\]]*\]\n?/g, '')
    .replace(/\[DATA[^\]]*\]\n?/g, '')
    .replace(/\[LABEL[^\]]*\]\n?/g, '')
    .replace(/\[HIGHLIGHT[^\]]*\]\n?/g, '');
}

// ============================================================
// HTML Builders
// ============================================================

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function buildMarketPulseHTML(stockData) {
  if (stockData.length === 0) {
    return '<span class="no-data">No relevant market data today</span>';
  }
  return stockData.map(s => {
    const isPositive = s.changePercent >= 0;
    const sign = isPositive ? '+' : '';
    const cls = isPositive ? 'positive' : 'negative';
    return `<div class="ticker-chip ${cls}">
      <span class="ticker-symbol">${escapeHtml(s.ticker)}</span>
      <span class="ticker-price">$${s.price.toFixed(2)}</span>
      <span class="ticker-change">${sign}${s.changePercent.toFixed(2)}%</span>
    </div>`;
  }).join('\n      ');
}

function buildStoriesHTML(stories) {
  if (stories.length === 0) {
    return '<p class="no-data">No major stories today.</p>';
  }
  return stories.map((story, i) => {
    const categoryClass = `category-${(story.category || 'business').toLowerCase()}`;
    const divider = i < stories.length - 1 ? '\n      <div class="story-divider"></div>' : '';

    return `<article class="story">
        <div class="story-header">
          ${story.category ? `<span class="category-tag ${categoryClass}">${escapeHtml(story.category)}</span>` : ''}
          <h3>${escapeHtml(story.headline)}</h3>
        </div>
        <p class="story-body">${renderMarkdown(story.body)}</p>
        ${story.whyItMatters ? `<p class="why-it-matters">Why it matters → ${renderMarkdown(story.whyItMatters)}</p>` : ''}
        ${story.market ? `<div class="market-note">
          <span class="market-label">MARKET</span>
          <p>${renderMarkdown(story.market)}</p>
        </div>` : ''}
      </article>${divider}`;
  }).join('\n      ');
}

function buildHeatmapHTML(stockData) {
  if (stockData.length === 0) {
    return '<p class="no-data">No relevant market data today</p>';
  }
  return stockData.map(s => {
    const isPositive = s.changePercent >= 0;
    const cls = isPositive ? 'positive' : 'negative';
    const intensity = Math.min(Math.abs(s.changePercent) / 5, 1);
    const sign = isPositive ? '+' : '';
    return `<div class="heatmap-card ${cls}" style="--intensity: ${intensity.toFixed(2)}">
        <span class="heatmap-ticker">${escapeHtml(s.ticker)}</span>
        <span class="heatmap-name">${escapeHtml(s.name)}</span>
        <span class="heatmap-change">${sign}${s.changePercent.toFixed(2)}%</span>
        <span class="heatmap-price">$${s.price.toFixed(2)}</span>
      </div>`;
  }).join('\n      ');
}

function buildQuickHitsHTML(quickHits) {
  if (quickHits.length === 0) return '<p class="no-data">No quick hits today.</p>';
  return quickHits.map(hit =>
    `<div class="quick-hit">${renderMarkdown(hit)}</div>`
  ).join('\n      ');
}

function buildTrackerHTML(tracker) {
  if (tracker.length === 0) return '<p class="no-data">Tracker unavailable.</p>';
  return tracker.map(dim =>
    `<div class="tracker-item">
        <div class="tracker-header">
          <span class="tracker-label">${escapeHtml(dim.label)}</span>
          <span class="tracker-percent">${dim.percent}%</span>
        </div>
        <div class="tracker-bar">
          <div class="tracker-fill" style="width: ${dim.percent}%; background: ${dim.color}"></div>
        </div>
        <p class="tracker-note">${escapeHtml(dim.note)}</p>
      </div>`
  ).join('\n      ');
}

function buildHTML(template, edition, stockData, dateStr) {
  const headline = edition.stories.length > 0 ? edition.stories[0].headline : 'The Signal';

  return template
    .replace(/\{\{DATE\}\}/g, formatDate(dateStr))
    .replace(/\{\{DATE_SHORT\}\}/g, formatDateShort(dateStr))
    .replace(/\{\{DATE_ISO\}\}/g, dateStr)
    .replace(/\{\{LEAD_IN\}\}/g, renderMarkdown(edition.leadIn))
    .replace(/\{\{MARKET_PULSE\}\}/g, buildMarketPulseHTML(stockData))
    .replace(/\{\{STORIES\}\}/g, buildStoriesHTML(edition.stories))
    .replace(/\{\{HEATMAP\}\}/g, buildHeatmapHTML(stockData))
    .replace(/\{\{QUICK_HITS\}\}/g, buildQuickHitsHTML(edition.quickHits))
    .replace(/\{\{BIGGER_PICTURE\}\}/g, renderMarkdown(edition.biggerPicture))
    .replace(/\{\{AGI_TRACKER\}\}/g, buildTrackerHTML(edition.tracker))
    .replace(/\{\{HEADLINE\}\}/g, escapeHtml(headline));
}

// ============================================================
// File Output
// ============================================================

function saveEdition(html, dateStr, headline) {
  fs.mkdirSync(EDITIONS_DIR, { recursive: true });

  // Write edition file
  const edPath = path.join(EDITIONS_DIR, `${dateStr}.html`);
  fs.writeFileSync(edPath, html, 'utf-8');
  console.log(`  Saved: docs/editions/${dateStr}.html`);

  // Copy to index.html
  fs.writeFileSync(INDEX_PATH, html, 'utf-8');
  console.log(`  Updated: docs/index.html`);

  // Update archive
  updateArchive(dateStr, headline);
}

function updateArchive(dateStr, headline) {
  let archiveHtml;

  if (fs.existsSync(ARCHIVE_PATH)) {
    archiveHtml = fs.readFileSync(ARCHIVE_PATH, 'utf-8');
  } else {
    archiveHtml = getBaseArchiveHTML();
  }

  const newEntry = `<a href="editions/${dateStr}.html" class="archive-entry">
      <span class="archive-date">${formatDateShort(dateStr)}</span>
      <span class="archive-headline">${escapeHtml(headline)}</span>
    </a>`;

  archiveHtml = archiveHtml.replace(
    '<!-- ENTRIES -->',
    `<!-- ENTRIES -->\n    ${newEntry}`
  );

  fs.writeFileSync(ARCHIVE_PATH, archiveHtml, 'utf-8');
  console.log(`  Updated: docs/archive.html`);
}

function getBaseArchiveHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Signal — Archive</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #1a1814;
      color: #f0ece4;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 660px;
      margin: 0 auto;
      padding: 24px 16px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid rgba(232,150,80,0.2);
      padding-bottom: 12px;
      margin-bottom: 32px;
    }
    .logo {
      font-size: 11px;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: #e89650;
      font-weight: 500;
    }
    .page-title {
      font-size: 13px;
      color: #9e9888;
      font-weight: 400;
    }
    .archive-list {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .archive-entry {
      display: flex;
      gap: 16px;
      align-items: baseline;
      padding: 14px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      text-decoration: none;
      transition: background 0.15s;
      padding-left: 8px;
      padding-right: 8px;
      border-radius: 4px;
    }
    .archive-entry:hover {
      background: rgba(232,150,80,0.06);
    }
    .archive-date {
      font-size: 13px;
      color: #8a8578;
      white-space: nowrap;
      min-width: 130px;
    }
    .archive-headline {
      font-size: 14px;
      color: #e8e4dc;
      font-weight: 500;
    }
    footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 48px;
      padding-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.04);
      font-size: 11px;
      color: #6b665c;
    }
    @media (max-width: 600px) {
      .archive-entry { flex-direction: column; gap: 4px; }
      .archive-date { min-width: auto; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <a href="index.html" style="text-decoration:none"><span class="logo">THE SIGNAL</span></a>
      <span class="page-title">Archive</span>
    </header>
    <div class="archive-list">
    <!-- ENTRIES -->
    </div>
    <footer>
      <span>Written by Claude &middot; Curated for you</span>
      <span>thesignal.ai</span>
    </footer>
  </div>
</body>
</html>`;
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  The Signal — ${formatDate(today)}`);
  console.log(`═══════════════════════════════════════\n`);

  // Load config
  const watchlistConfig = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf-8'));
  const systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  // Step 1: Fetch RSS news
  console.log('[1/5] Fetching RSS news...');
  const newsHeadlines = await fetchRSSNews(watchlistConfig.rss_feeds || []);
  console.log(`  Found ${newsHeadlines.length} recent headlines\n`);

  // Step 2: Call Claude
  console.log('[2/5] Generating edition with Claude...');
  const rawText = await callClaude(systemPrompt, newsHeadlines, watchlistConfig);
  console.log('');

  // Step 3: Parse response
  console.log('[3/5] Parsing response...');
  const edition = parseEdition(rawText);
  console.log(`  ${edition.stories.length} stories, ${edition.quickHits.length} quick hits, ${edition.tracker.length} tracker dimensions\n`);

  // Step 4: Fetch stock data for mentioned tickers only
  const mentionedTickers = findMentionedTickers(rawText, watchlistConfig.watchlist);
  console.log(`[4/5] Fetching stock data for ${mentionedTickers.length} mentioned tickers...`);
  if (mentionedTickers.length > 0) {
    console.log(`  Tickers: ${mentionedTickers.map(t => t.ticker).join(', ')}`);
  }
  const stockData = await fetchStockData(mentionedTickers);
  console.log(`  Got data for ${stockData.length} tickers\n`);

  // Step 5: Build and save
  console.log('[5/5] Building HTML and saving...');
  const html = buildHTML(template, edition, stockData, today);
  const headline = edition.stories.length > 0 ? edition.stories[0].headline : 'The Signal';
  saveEdition(html, today, headline);

  console.log(`\n✓ Done! Open docs/editions/${today}.html in your browser.\n`);
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
