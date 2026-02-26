import { NextRequest, NextResponse } from 'next/server';
import FirecrawlApp from '@mendable/firecrawl-js';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Initialize Firecrawl with API key from environment
    const apiKey = process.env.FIRECRAWL_API_KEY;
    
    if (!apiKey) {
      console.error("FIRECRAWL_API_KEY not configured");
      return NextResponse.json({ 
        error: 'Firecrawl API key not configured' 
      }, { status: 500 });
    }
    
    const app = new FirecrawlApp({ apiKey });

    console.log('[scrape-screenshot] Attempting to capture screenshot for:', url);
    console.log('[scrape-screenshot] Using Firecrawl API key:', apiKey ? 'Present' : 'Missing');

    let scrapeResult;
    let lastError;

    // Attempt 1: Fast optimized approach
    try {
      console.log('[scrape-screenshot] Attempt 1: Fast optimized approach');
      scrapeResult = await app.scrape(url, {
        formats: ['screenshot'],
        waitFor: 2000,
        timeout: 30000,
        onlyMainContent: false,
        includeTags: ['body'],
        excludeTags: ['script', 'iframe', 'embed', 'object'],
        actions: [{ type: 'wait', milliseconds: 1000 }],
        blockAds: true,
      });
    } catch (error: any) {
      console.log('[scrape-screenshot] Fast approach failed:', error.message);
      lastError = error;
    }

    // Attempt 2: Balanced approach if first failed
    if (!scrapeResult) {
      try {
        console.log('[scrape-screenshot] Attempt 2: Balanced approach');
        scrapeResult = await app.scrape(url, {
          formats: ['screenshot'],
          waitFor: 3000,
          timeout: 45000,
          onlyMainContent: false,
          includeTags: ['body'],
          excludeTags: ['script', 'iframe', 'embed', 'object'],
          actions: [{ type: 'wait', milliseconds: 2000 }],
          blockAds: true,
        });
      } catch (error: any) {
        console.log('[scrape-screenshot] Balanced approach failed:', error.message);
        lastError = error;
      }
    }

    // Attempt 3: Minimal approach if still failed
    if (!scrapeResult) {
      try {
        console.log('[scrape-screenshot] Attempt 3: Minimal approach');
        scrapeResult = await app.scrape(url, {
          formats: ['screenshot'],
          waitFor: 1000,
          timeout: 20000,
          onlyMainContent: true, // Only main content
          includeTags: ['body'],
          excludeTags: ['script', 'style', 'iframe', 'embed', 'object'],
          actions: [], // No additional waits
          blockAds: true,
        });
      } catch (error: any) {
        console.log('[scrape-screenshot] Minimal approach failed:', error.message);
        lastError = error;
      }
    }

    console.log('[scrape-screenshot] Full scrape result:', JSON.stringify(scrapeResult, null, 2));
    console.log('[scrape-screenshot] Scrape result type:', typeof scrapeResult);
    console.log('[scrape-screenshot] Scrape result keys:', scrapeResult ? Object.keys(scrapeResult) : 'null');
    
    // The Firecrawl v4 API might return data directly without a success flag
    // Check if we have data with screenshot
    if (scrapeResult && scrapeResult.screenshot) {
      // Direct screenshot response
      return NextResponse.json({
        success: true,
        screenshot: scrapeResult.screenshot,
        metadata: scrapeResult.metadata || {}
      });
    } else if ((scrapeResult as any)?.data?.screenshot) {
      // Nested data structure
      return NextResponse.json({
        success: true,
        screenshot: (scrapeResult as any).data.screenshot,
        metadata: (scrapeResult as any).data.metadata || {}
      });
    } else if ((scrapeResult as any)?.success === false) {
      // Explicit failure
      console.error('[scrape-screenshot] Firecrawl API error:', (scrapeResult as any).error);
      throw new Error((scrapeResult as any).error || 'Failed to capture screenshot');
    } else {
      // No screenshot in response
      console.error('[scrape-screenshot] No screenshot in response. Full response:', JSON.stringify(scrapeResult, null, 2));
      throw new Error('Screenshot not available in response - check console for full response structure');
    }

  } catch (error: any) {
    console.error('[scrape-screenshot] Screenshot capture error:', error);
    console.error('[scrape-screenshot] Error stack:', error.stack);
    
    // Check for specific timeout errors
    if (error.message?.includes('timeout') || error.code === 'ETIMEDOUT') {
      console.log('[scrape-screenshot] Timeout detected - providing fallback response');
      return NextResponse.json({ 
        success: false,
        error: 'Screenshot capture timed out. The website may be slow or have heavy content. You can proceed without the screenshot.',
        screenshot: null,
        fallback: true
      }, { status: 200 }); // Return 200 so the frontend can handle the fallback
    }
    
    // Check for Firecrawl API errors
    if (error.message?.includes('Firecrawl API error')) {
      console.log('[scrape-screenshot] Firecrawl API error - providing fallback response');
      return NextResponse.json({ 
        success: false,
        error: 'Screenshot service temporarily unavailable. You can proceed without the screenshot.',
        screenshot: null,
        fallback: true
      }, { status: 200 }); // Return 200 so the frontend can handle the fallback
    }
    
    // Generic error with fallback option
    return NextResponse.json({ 
      success: false,
      error: error.message || 'Failed to capture screenshot',
      screenshot: null,
      fallback: true
    }, { status: 200 }); // Return 200 so the frontend can handle the fallback
  }
}