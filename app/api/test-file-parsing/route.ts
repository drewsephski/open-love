import { NextRequest, NextResponse } from 'next/server';

function parseAIResponse(response: string) {
  const sections = {
    files: [] as Array<{ path: string; content: string }>,
    packages: [] as string[],
    explanation: '',
  };

  // Parse file sections
  const fileRegex = /<file path="([^"]+)">([\s\S]*?)(?:<\/file>|$)/g;
  let match;
  while ((match = fileRegex.exec(response)) !== null) {
    const filePath = match[1];
    const content = match[2].trim();
    const hasClosingTag = response.substring(match.index, match.index + match[0].length).includes('</file>');

    console.log(`[test-parse] Found file: ${filePath}, hasClosingTag: ${hasClosingTag}, contentLength: ${content.length}`);
    
    sections.files.push({
      path: filePath,
      content
    });
  }

  return sections;
}

export async function POST(request: NextRequest) {
  try {
    const { response } = await request.json();
    
    console.log('[test-parse] Testing file parsing...');
    console.log('[test-parse] Response length:', response.length);
    console.log('[test-parse] Response preview:', response.substring(0, 500));
    
    const parsed = parseAIResponse(response);
    
    return NextResponse.json({
      success: true,
      filesFound: parsed.files.length,
      files: parsed.files.map(f => ({
        path: f.path,
        contentLength: f.content.length,
        contentPreview: f.content.substring(0, 200)
      })),
      packages: parsed.packages
    });
    
  } catch (error: any) {
    console.error('[test-parse] Error:', error);
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
