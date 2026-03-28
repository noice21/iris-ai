import puppeteer from 'puppeteer';
import fetch from 'node-fetch';
import { existsSync } from 'fs';

// Lazy env readers
function getSearchProvider() {
  return (process.env.SEARCH_PROVIDER || 'puppeteer').toLowerCase();
}

function getBraveApiKey() {
  return process.env.BRAVE_SEARCH_API_KEY || '';
}

/**
 * Launch a headless browser (Chrome/Edge/Chromium)
 */
async function launchBrowser() {
  // Check env var first (set by Dockerfile for container deployments)
  if (process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    console.log(`[WebSearch] Using browser from env: ${executablePath}`);
    return await puppeteer.launch({
      headless: 'new',
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ],
      timeout: 30000
    });
  }

  // Windows browser paths (local development)
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome'
  ];

  let executablePath = undefined;
  for (const p of chromePaths) {
    if (existsSync(p)) {
      executablePath = p;
      console.log(`[WebSearch] Using browser at: ${p}`);
      break;
    }
  }

  return await puppeteer.launch({
    headless: 'new',
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ],
    timeout: 30000
  });
}

/**
 * Search the web using Brave Search API
 */
async function searchBrave(query, numResults = 10) {
  const apiKey = getBraveApiKey();
  if (!apiKey) {
    throw new Error('BRAVE_SEARCH_API_KEY is not set. Set it in .env or switch SEARCH_PROVIDER to puppeteer.');
  }

  console.log(`[WebSearch] Brave search for: "${query}" (${numResults} results)`);

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(numResults, 20)}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Brave Search API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  const results = (data.web?.results || []).map(r => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || ''
  }));

  // Check for featured snippet / infobox
  let featuredSnippet = null;
  if (data.infobox?.results?.[0]?.description) {
    featuredSnippet = data.infobox.results[0].description;
  } else if (data.mixed?.main?.[0]?.type === 'infobox') {
    featuredSnippet = data.mixed.main[0].description || null;
  }

  return {
    success: true,
    query,
    featuredSnippet,
    results,
    resultCount: results.length,
    provider: 'brave',
    timestamp: new Date().toISOString()
  };
}

/**
 * Search the web using Puppeteer + DuckDuckGo
 */
async function searchPuppeteer(query, numResults = 10) {
  let browser;
  try {
    console.log(`[WebSearch] Puppeteer/DuckDuckGo search for: "${query}" (${numResults} results)`);

    browser = await launchBrowser();
    const page = await browser.newPage();

    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(30000);

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await new Promise(resolve => setTimeout(resolve, 1500));

    const maxResults = Math.min(numResults, 20);

    const results = await page.evaluate((max) => {
      const searchResults = [];
      const resultElements = document.querySelectorAll('.result');

      for (let i = 0; i < Math.min(resultElements.length, max); i++) {
        const element = resultElements[i];
        const linkElement = element.querySelector('.result__a');
        const snippetElement = element.querySelector('.result__snippet');

        if (linkElement) {
          searchResults.push({
            title: linkElement.textContent.trim(),
            url: linkElement.href,
            snippet: snippetElement ? snippetElement.textContent.trim() : ''
          });
        }
      }

      return searchResults;
    }, maxResults);

    const instantAnswer = await page.evaluate(() => {
      const answerBox = document.querySelector('.result--answer');
      if (answerBox) {
        const text = answerBox.querySelector('.result__snippet');
        return text ? text.textContent.trim() : null;
      }
      return null;
    });

    await browser.close();

    console.log(`[WebSearch] Found ${results.length} results for "${query}"`);

    return {
      success: true,
      query,
      featuredSnippet: instantAnswer,
      results,
      resultCount: results.length,
      provider: 'puppeteer',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    throw error;
  }
}

/**
 * Search the web (routes to configured provider)
 */
async function searchWeb(query, numResults = 10) {
  try {
    if (getSearchProvider() === 'brave') {
      return await searchBrave(query, numResults);
    }
    return await searchPuppeteer(query, numResults);
  } catch (error) {
    console.error(`[WebSearch] Search failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      query,
      details: `Search failed: ${error.message}. This could be due to network issues or timeout.`
    };
  }
}

/**
 * Visit a webpage and extract its main text content
 */
async function visitWebpage(url) {
  let browser;
  try {
    console.log(`[WebSearch] Visiting webpage: ${url}`);

    browser = await launchBrowser();
    const page = await browser.newPage();

    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(30000);

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for content to settle
    await new Promise(resolve => setTimeout(resolve, 2000));

    const pageTitle = await page.title();

    const content = await page.evaluate(() => {
      // Remove non-content elements
      const removeSelectors = ['nav', 'header', 'footer', 'sidebar', 'aside', 'script', 'style', 'noscript', '.nav', '.header', '.footer', '.sidebar', '.menu', '.ad', '.advertisement', '.cookie-banner', '.popup'];
      for (const selector of removeSelectors) {
        document.querySelectorAll(selector).forEach(el => el.remove());
      }

      // Try to find main content area
      const mainContent = document.querySelector('main') ||
        document.querySelector('article') ||
        document.querySelector('[role="main"]') ||
        document.querySelector('.content') ||
        document.querySelector('#content') ||
        document.body;

      return mainContent ? mainContent.innerText.trim() : '';
    });

    await browser.close();

    const maxLength = 8000;
    const truncated = content.length > maxLength;
    const finalContent = truncated ? content.substring(0, maxLength) + '\n\n[Content truncated...]' : content;

    return {
      success: true,
      url,
      title: pageTitle,
      content: finalContent,
      contentLength: content.length,
      truncated,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }

    console.error(`[WebSearch] Visit webpage failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      url,
      details: `Failed to visit webpage: ${error.message}`
    };
  }
}

// Tool definitions
export const WEB_SEARCH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for information using a headless browser or Brave Search API. The search runs invisibly in the background. Use this when you need up-to-date information or facts you don\'t know.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g., "what is the weather today", "latest news about AI")'
          },
          num_results: {
            type: 'number',
            description: 'Number of results to return (default: 10, max: 20)'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'visit_webpage',
      description: 'Visit a specific webpage URL and extract its main text content. Use this to read articles, documentation, or any web page when you need more detail than a search snippet provides.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to visit (e.g., "https://example.com/article")'
          }
        },
        required: ['url']
      }
    }
  }
];

/**
 * Execute a web search tool
 */
export async function executeWebSearchTool(toolName, args = {}) {
  console.log(`[WebSearch] Executing tool: ${toolName}`, args);

  try {
    switch (toolName) {
      case 'search_web':
        return await searchWeb(args.query, args.num_results || 10);

      case 'visit_webpage':
        return await visitWebpage(args.url);

      default:
        throw new Error(`Unknown web search tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`[WebSearch] Tool execution failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
