import { NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

declare global {
  var activeSandboxProvider: any;
}

export async function GET() {
  try {
    const diagnostics: {
      timestamp: string;
      viteStatus: string;
      viteLog: string;
      fileContents: Record<string, any>;
      networkTest: boolean;
      error?: string;
    } = {
      timestamp: new Date().toISOString(),
      viteStatus: 'unknown',
      viteLog: '',
      fileContents: {},
      networkTest: false
    };

    // Get the active sandbox provider
    const provider = sandboxManager.getActiveProvider() || global.activeSandboxProvider;
    
    if (!provider) {
      diagnostics.viteStatus = 'no_provider';
      return NextResponse.json(diagnostics);
    }

    try {
      // Check if Vite is running
      const viteCheck = await provider.runCommand('pgrep -f "vite" || echo "VITE_NOT_RUNNING"');
      diagnostics.viteStatus = viteCheck.stdout.includes('VITE_NOT_RUNNING') ? 'not_running' : 'running';

      // Get recent Vite logs
      const logCheck = await provider.runCommand('tail -20 /tmp/vite.log 2>/dev/null || echo "NO_LOG_FILE"');
      diagnostics.viteLog = logCheck.stdout.includes('NO_LOG_FILE') ? 'No log file found' : logCheck.stdout;

      // Check if key files exist and have content
      const keyFiles = ['src/App.jsx', 'src/main.jsx', 'index.html'];
      for (const file of keyFiles) {
        try {
          const content = await provider.readFile(file);
          diagnostics.fileContents[file] = {
            exists: true,
            size: content.length,
            preview: content.substring(0, 200)
          };
        } catch (e) {
          diagnostics.fileContents[file] = {
            exists: false,
            error: (e as Error).message
          };
        }
      }

      // Test network connectivity to the Vite server
      try {
        const sandboxInfo = provider.getSandboxInfo?.();
        if (sandboxInfo?.url) {
          const testUrl = `${sandboxInfo.url.replace(/\/$/, '')}/src/main.jsx`;
          const networkTest = await provider.runCommand(`curl -s -o /dev/null -w "%{http_code}" "${testUrl}" || echo "CURL_FAILED"`);
          diagnostics.networkTest = networkTest.stdout === '200' || networkTest.stdout.includes('CURL_FAILED') ? false : true;
        }
      } catch (e) {
        diagnostics.networkTest = false;
      }

      // If Vite is not running, try to restart it
      if (diagnostics.viteStatus === 'not_running') {
        console.log('[check-vite-status] Attempting to restart Vite...');
        try {
          await provider.runCommand('cd /vercel/sandbox && nohup npm run dev > /tmp/vite.log 2>&1 &');
          
          // Wait a bit and check again
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          const recheck = await provider.runCommand('pgrep -f "vite" || echo "VITE_NOT_RUNNING"');
          diagnostics.viteStatus = recheck.stdout.includes('VITE_NOT_RUNNING') ? 'restart_failed' : 'restarted';
        } catch (e) {
          diagnostics.viteStatus = 'restart_failed';
          console.error('[check-vite-status] Failed to restart Vite:', e);
        }
      }

    } catch (e) {
      diagnostics.viteStatus = 'error';
      diagnostics.error = (e as Error).message;
    }

    return NextResponse.json(diagnostics);

  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
