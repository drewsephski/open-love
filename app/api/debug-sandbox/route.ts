import { NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import type { SandboxState } from '@/types/sandbox';

declare global {
  var activeSandboxProvider: any;
  var sandboxData: any;
  var existingFiles: Set<string>;
  var sandboxState: SandboxState;
}

interface Diagnostics {
  timestamp: string;
  environment: {
    NODE_ENV: string | undefined;
    SANDBOX_PROVIDER: string | undefined;
    VERCEL_OIDC_TOKEN: string;
    VERCEL_TOKEN: string;
    VERCEL_TEAM_ID: string;
    VERCEL_PROJECT_ID: string;
    E2B_API_KEY: string;
  };
  globalState: {
    activeSandboxProvider: boolean;
    sandboxData: boolean;
    existingFilesCount: number;
    existingFiles: string[];
    sandboxState: boolean;
  };
  sandboxManager: {
    activeSandboxes: string[];
    providerCount: number;
  };
  sandboxInfo?: {
    sandboxId: string;
    url: string;
    provider: string;
  };
  fileTest?: {
    success: boolean;
    writePath?: string;
    contentMatch?: boolean;
    readContent?: string;
    error?: string;
  };
  commandTest?: {
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
  };
  sandboxError?: {
    error: string;
  };
}

export async function GET() {
  try {
    const diagnostics: Diagnostics = {
      timestamp: new Date().toISOString(),
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
        VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN ? 'SET' : 'NOT_SET',
        VERCEL_TOKEN: process.env.VERCEL_TOKEN ? 'SET' : 'NOT_SET',
        VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID || 'NOT_SET',
        VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID || 'NOT_SET',
        E2B_API_KEY: process.env.E2B_API_KEY ? 'SET' : 'NOT_SET',
      },
      globalState: {
        activeSandboxProvider: !!global.activeSandboxProvider,
        sandboxData: !!global.sandboxData,
        existingFilesCount: global.existingFiles?.size || 0,
        existingFiles: Array.from(global.existingFiles || []),
        sandboxState: !!global.sandboxState,
      },
      sandboxManager: {
        activeSandboxes: Array.from((sandboxManager as any).sandboxes?.keys() || []),
        providerCount: (sandboxManager as any).sandboxes?.size || 0,
      },
    };

    // Test sandbox connectivity if available
    if (global.activeSandboxProvider) {
      try {
        const sandboxInfo = global.activeSandboxProvider.getSandboxInfo?.();
        if (sandboxInfo) {
          diagnostics.sandboxInfo = {
            sandboxId: sandboxInfo.sandboxId,
            url: sandboxInfo.url,
            provider: sandboxInfo.provider,
          };

          // Test file write
          try {
            const testPath = 'test-file.txt';
            const testContent = `Test file at ${new Date().toISOString()}`;
            await global.activeSandboxProvider.writeFile(testPath, testContent);
            
            // Test file read
            const readContent = await global.activeSandboxProvider.readFile(testPath);
            diagnostics.fileTest = {
              success: true,
              writePath: testPath,
              contentMatch: readContent === testContent,
              readContent: readContent.substring(0, 100),
            };

            // Clean up test file
            await global.activeSandboxProvider.runCommand('rm test-file.txt');
          } catch (fileTestError: any) {
            diagnostics.fileTest = {
              success: false,
              error: fileTestError.message,
            };
          }

          // Test command execution
          try {
            const result = await global.activeSandboxProvider.runCommand('pwd && ls -la');
            diagnostics.commandTest = {
              success: result.exitCode === 0,
              exitCode: result.exitCode,
              stdout: result.stdout?.substring(0, 200),
              stderr: result.stderr?.substring(0, 200),
            };
          } catch (commandTestError: any) {
            diagnostics.commandTest = {
              success: false,
              error: commandTestError.message,
            };
          }
        }
      } catch (sandboxError: any) {
        diagnostics.sandboxError = {
          error: sandboxError.message,
        };
      }
    }

    return NextResponse.json(diagnostics);
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
}
