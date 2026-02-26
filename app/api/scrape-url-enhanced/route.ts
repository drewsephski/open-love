import { NextRequest, NextResponse } from 'next/server';

// Function to sanitize smart quotes and other problematic characters
function sanitizeQuotes(text: string): string {
  return text
    // Replace smart single quotes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    // Replace smart double quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // Replace other quote-like characters
    .replace(/[\u00AB\u00BB]/g, '"') // Guillemets
    .replace(/[\u2039\u203A]/g, "'") // Single guillemets
    // Replace other problematic characters
    .replace(/[\u2013\u2014]/g, '-') // En dash and em dash
    .replace(/[\u2026]/g, '...') // Ellipsis
    .replace(/[\u00A0]/g, ' '); // Non-breaking space
}

export async function POST(request: NextRequest) {
  let url = '';
  
  try {
    const body = await request.json();
    url = body.url;
    
    if (!url) {
      return NextResponse.json({
        success: false,
        error: 'URL is required'
      }, { status: 400 });
    }
    
    console.log('[scrape-url-enhanced] Scraping with Firecrawl:', url);
    
    const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
    if (!FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY environment variable is not set');
    }
    
    // Make request to Firecrawl API with optimized settings for reliability
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'], // Focus on markdown only for speed
        waitFor: 3000, // Reduced wait time
        timeout: 45000, // 45 seconds for better balance
        blockAds: true,
        maxAge: 3600000, // Use cached data if less than 1 hour old
        includeTags: ['body', 'h1', 'h2', 'h3', 'p', 'a'], // Essential content tags only
        excludeTags: ['script', 'iframe', 'embed', 'object', 'style'], // Exclude heavy elements
        actions: [
          {
            type: 'wait',
            milliseconds: 2000 // Reasonable wait
          }
        ]
      })
    });
    
    if (!firecrawlResponse.ok) {
      const error = await firecrawlResponse.text();
      throw new Error(`Firecrawl API error: ${error}`);
    }
    
    const data = await firecrawlResponse.json();
    
    if (!data.success || !data.data) {
      throw new Error('Failed to scrape content');
    }
    
    const { markdown, metadata } = data.data;
    // Screenshot is handled separately by the screenshot API
    
    // Sanitize the markdown content
    const sanitizedMarkdown = sanitizeQuotes(markdown || '');
    
    // Extract structured data from the response
    const title = metadata?.title || '';
    const description = metadata?.description || '';
    
    // Format content for AI
    const formattedContent = `
Title: ${sanitizeQuotes(title)}
Description: ${sanitizeQuotes(description)}
URL: ${url}

Main Content:
${sanitizedMarkdown}
    `.trim();
    
    return NextResponse.json({
      success: true,
      url,
      content: formattedContent,
      screenshot: null, // Screenshot handled separately
      structured: {
        title: sanitizeQuotes(title),
        description: sanitizeQuotes(description),
        content: sanitizedMarkdown,
        url,
        screenshot: null
      },
      metadata: {
        scraper: 'firecrawl-enhanced',
        timestamp: new Date().toISOString(),
        contentLength: formattedContent.length,
        cached: data.data.cached || false,
        ...metadata
      },
      message: 'URL scraped successfully with Firecrawl (optimized for speed and reliability)'
    });
    
  } catch (error: any) {
    console.error('[scrape-url-enhanced] Error:', error);
    
    // Check for timeout errors specifically
    if (error.message?.includes('timeout') || error.code === 'ETIMEDOUT') {
      console.log('[scrape-url-enhanced] Timeout detected - providing fallback response');
      return NextResponse.json({
        success: false,
        error: 'Website scraping timed out. The site may be slow or have heavy content. You can proceed by describing what you want to build.',
        fallback: true,
        url,
        content: null,
        screenshot: null
      }, { status: 200 }); // Return 200 so frontend can handle fallback
    }
    
    // Check for Firecrawl API errors
    if (error.message?.includes('Firecrawl API error')) {
      console.log('[scrape-url-enhanced] Firecrawl API error - providing fallback response');
      return NextResponse.json({
        success: false,
        error: 'Scraping service temporarily unavailable. You can proceed by describing what you want to build.',
        fallback: true,
        url,
        content: null,
        screenshot: null
      }, { status: 200 });
    }
    
    // Generic error with fallback
    return NextResponse.json({
      success: false,
      error: (error as Error).message || 'Failed to scrape URL',
      fallback: true,
      url,
      content: null,
      screenshot: null
    }, { status: 200 });
  }
}