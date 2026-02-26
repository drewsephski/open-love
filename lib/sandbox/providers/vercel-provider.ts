import { Sandbox } from '@vercel/sandbox';
import { SandboxProvider, SandboxInfo, CommandResult } from '../types';
// SandboxProviderConfig available through parent class

export class VercelProvider extends SandboxProvider {
  private existingFiles: Set<string> = new Set();

  async createSandbox(): Promise<SandboxInfo> {
    try {
      
      // Kill existing sandbox if any
      if (this.sandbox) {
        try {
          await this.sandbox.stop();
        } catch (e) {
          console.error('Failed to stop existing sandbox:', e);
        }
        this.sandbox = null;
      }
      
      // Clear existing files tracking
      this.existingFiles.clear();

      // Create Vercel sandbox
      
      const sandboxConfig: any = {
        timeout: 600000, // 10 minutes in ms (increased from 5 minutes)
        runtime: 'node22', // Use node22 runtime for Vercel sandboxes
        ports: [5173] // Vite port
      };

      // Add authentication based on environment variables
      if (process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID) {
        sandboxConfig.teamId = process.env.VERCEL_TEAM_ID;
        sandboxConfig.projectId = process.env.VERCEL_PROJECT_ID;
        sandboxConfig.token = process.env.VERCEL_TOKEN;
      } else if (process.env.VERCEL_OIDC_TOKEN) {
        sandboxConfig.oidcToken = process.env.VERCEL_OIDC_TOKEN;
      }

      this.sandbox = await Sandbox.create(sandboxConfig);
      
      const sandboxId = this.sandbox.sandboxId;
      // Sandbox created successfully
      
      // Get the sandbox URL using the correct Vercel Sandbox API
      const sandboxUrl = this.sandbox.domain(5173);

      this.sandboxInfo = {
        sandboxId,
        url: sandboxUrl,
        provider: 'vercel',
        createdAt: new Date()
      };

      return this.sandboxInfo;

    } catch (error) {
      console.error('[VercelProvider] Error creating sandbox:', error);
      throw error;
    }
  }

  async runCommand(command: string): Promise<CommandResult> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    
    try {
      // Parse command into cmd and args (matching PR syntax)
      const parts = command.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);
      
      // Vercel uses runCommand with cmd and args object (based on PR)
      const result = await this.sandbox.runCommand({
        cmd: cmd,
        args: args,
        cwd: '/vercel/sandbox',
        env: {}
      });
      
      // Handle stdout and stderr - they might be functions in Vercel SDK
      let stdout = '';
      let stderr = '';
      
      try {
        if (typeof result.stdout === 'function') {
          stdout = await result.stdout();
        } else {
          stdout = result.stdout || '';
        }
      } catch (e) {
        stdout = '';
      }
      
      try {
        if (typeof result.stderr === 'function') {
          stderr = await result.stderr();
        } else {
          stderr = result.stderr || '';
        }
      } catch (e) {
        stderr = '';
      }
      
      return {
        stdout: stdout,
        stderr: stderr,
        exitCode: result.exitCode || 0,
        success: result.exitCode === 0
      };
    } catch (error: any) {
      return {
        stdout: '',
        stderr: error.message || 'Command failed',
        exitCode: 1,
        success: false
      };
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    // Vercel sandbox default working directory is /vercel/sandbox
    const fullPath = path.startsWith('/') ? path : `/vercel/sandbox/${path}`;
    
    // Writing file to sandbox
    
    // Based on Vercel SDK docs, writeFiles expects path and Buffer content
    try {
      const buffer = Buffer.from(content, 'utf-8');
      // Writing file with buffer
      
      await this.sandbox.writeFiles([{
        path: fullPath,
        content: buffer
      }]);
      
      this.existingFiles.add(path);
    } catch (writeError: any) {
      // Check for sandbox timeout/stopped errors
      if (writeError?.response?.status === 410 || 
          writeError?.response?.data?.error?.code === 'sandbox_stopped') {
        console.error('[VercelProvider] Sandbox has stopped execution - this usually means it timed out');
        throw new Error('SANDBOX_TIMEOUT: The sandbox has expired due to time limits. Please start a new generation.');
      }
      
      // Log detailed error information
      console.error(`[VercelProvider] writeFiles failed for ${fullPath}:`, {
        error: writeError,
        message: writeError?.message,
        response: writeError?.response,
        statusCode: writeError?.response?.status,
        responseData: writeError?.response?.data
      });
      
      // Fallback to command-based approach if writeFiles fails
      // Falling back to command-based file write
      
      // Ensure directory exists
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      if (dir) {
        const mkdirResult = await this.sandbox.runCommand({
          cmd: 'mkdir',
          args: ['-p', dir]
        });
        // Directory created
      }
      
      // Write file using echo and redirection
      const escapedContent = content
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/\n/g, '\\n');
      
      const writeResult = await this.sandbox.runCommand({
        cmd: 'sh',
        args: ['-c', `echo "${escapedContent}" > "${fullPath}"`]
      });
      
      // File written
      
      if (writeResult.exitCode === 0) {
        this.existingFiles.add(path);
      } else {
        throw new Error(`Failed to write file via command: ${writeResult.stderr}`);
      }
    }
  }

  async readFile(path: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    // Vercel sandbox default working directory is /vercel/sandbox
    const fullPath = path.startsWith('/') ? path : `/vercel/sandbox/${path}`;
    
    const result = await this.sandbox.runCommand({
      cmd: 'cat',
      args: [fullPath]
    });
    
    // Handle stdout and stderr - they might be functions in Vercel SDK
    let stdout = '';
    let stderr = '';
    
    try {
      if (typeof result.stdout === 'function') {
        stdout = await result.stdout();
      } else {
        stdout = result.stdout || '';
      }
    } catch (e) {
      stdout = '';
    }
    
    try {
      if (typeof result.stderr === 'function') {
        stderr = await result.stderr();
      } else {
        stderr = result.stderr || '';
      }
    } catch (e) {
      stderr = '';
    }
    
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file: ${stderr}`);
    }
    
    return stdout;
  }

  async listFiles(directory: string = '/vercel/sandbox'): Promise<string[]> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    const result = await this.sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', `find ${directory} -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/.next/*" -not -path "*/dist/*" -not -path "*/build/*" | sed "s|^${directory}/||"`],
      cwd: '/'
    });
    
    // Handle stdout - it might be a function in Vercel SDK
    let stdout = '';
    
    try {
      if (typeof result.stdout === 'function') {
        stdout = await result.stdout();
      } else {
        stdout = result.stdout || '';
      }
    } catch (e) {
      stdout = '';
    }
    
    if (result.exitCode !== 0) {
      return [];
    }
    
    return stdout.split('\n').filter((line: string) => line.trim() !== '');
  }

  async installPackages(packages: string[]): Promise<CommandResult> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    const flags = process.env.NPM_FLAGS || '';
    
    // Installing packages
    
    // Build args array
    const args = ['install'];
    if (flags) {
      args.push(...flags.split(' '));
    }
    args.push(...packages);
    
    const result = await this.sandbox.runCommand({
      cmd: 'npm',
      args: args,
      cwd: '/vercel/sandbox'
    });
    
    // Handle stdout and stderr - they might be functions in Vercel SDK
    let stdout = '';
    let stderr = '';
    
    try {
      if (typeof result.stdout === 'function') {
        stdout = await result.stdout();
      } else {
        stdout = result.stdout || '';
      }
    } catch (e) {
      stdout = '';
    }
    
    try {
      if (typeof result.stderr === 'function') {
        stderr = await result.stderr();
      } else {
        stderr = result.stderr || '';
      }
    } catch (e) {
      stderr = '';
    }
    
    // Restart Vite if configured and successful
    if (result.exitCode === 0 && process.env.AUTO_RESTART_VITE === 'true') {
      await this.restartViteServer();
    }
    
    return {
      stdout: stdout,
      stderr: stderr,
      exitCode: result.exitCode || 0,
      success: result.exitCode === 0
    };
  }

  async setupViteApp(): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    // Setting up Vite app for sandbox
    
    // Create directory structure
    const mkdirResult = await this.sandbox.runCommand({
      cmd: 'mkdir',
      args: ['-p', '/vercel/sandbox/src']
    });
    // Directory structure created
    
    // Create package.json
    const packageJson = {
      name: "sandbox-app",
      version: "1.0.0",
      type: "module",
      scripts: {
        dev: "vite --host",
        build: "vite build",
        preview: "vite preview"
      },
      dependencies: {
        react: "^18.2.0",
        "react-dom": "^18.2.0"
      },
      devDependencies: {
        "@vitejs/plugin-react": "^4.0.0",
        vite: "^4.3.9",
        tailwindcss: "^3.3.0",
        postcss: "^8.4.31",
        autoprefixer: "^10.4.16"
      }
    };
    
    await this.writeFile('package.json', JSON.stringify(packageJson, null, 2));
    
    // Create vite.config.js
    const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: [
      '.vercel.run',  // Allow all Vercel sandbox domains
      '.e2b.dev',     // Allow all E2B sandbox domains
      'localhost'
    ],
    hmr: {
      clientPort: 443,
      protocol: 'wss'
    }
  }
})`;
    
    await this.writeFile('vite.config.js', viteConfig);
    
    // Create tailwind.config.js
    const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}`;
    
    await this.writeFile('tailwind.config.js', tailwindConfig);
    
    // Create postcss.config.js
    const postcssConfig = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`;
    
    await this.writeFile('postcss.config.js', postcssConfig);
    
    // Create index.html
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sandbox App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`;
    
    await this.writeFile('index.html', indexHtml);
    
    // Create src/main.jsx
    const mainJsx = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`;
    
    await this.writeFile('src/main.jsx', mainJsx);
    
    // Create src/App.jsx
    const appJsx = `function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 text-gray-900 flex items-center justify-center p-4">
      <div className="text-center max-w-2xl">
        <div className="mb-8">
          <div className="w-20 h-20 bg-indigo-500 rounded-full mx-auto mb-4 flex items-center justify-center">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Open Lovable Sandbox</h1>
          <p className="text-lg text-gray-600 mb-4">
            Ready for AI-powered code generation
          </p>
        </div>
        
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-3 text-gray-800">Getting Started</h2>
          <div className="text-left space-y-2 text-gray-600">
            <p>✨ AI is generating your application...</p>
            <p>🔄 This page will update automatically</p>
            <p>📱 Your responsive app will appear here</p>
          </div>
        </div>
        
        <div className="flex items-center justify-center space-x-2">
          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
        </div>
        
        <p className="text-sm text-gray-500 mt-6">
          Powered by Vite + React + Tailwind CSS
        </p>
      </div>
    </div>
  )
}

export default App`;
    
    await this.writeFile('src/App.jsx', appJsx);
    
    // Create src/index.css
    const indexCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background-color: rgb(17 24 39);
}`;
    
    await this.writeFile('src/index.css', indexCss);
    
    // Installing npm dependencies
    
    // Install dependencies
    try {
      const installResult = await this.sandbox.runCommand({
        cmd: 'npm',
        args: ['install'],
        cwd: '/vercel/sandbox'
      });
      
      // npm install completed
      
      if (installResult.exitCode === 0) {
        // Dependencies installed successfully
      } else {
        console.warn('[VercelProvider] npm install had issues:', installResult.stderr);
      }
    } catch (error: any) {
      console.error('[VercelProvider] npm install error:', {
        message: error?.message,
        response: error?.response?.status,
        responseText: error?.text
      });
      // Try alternative approach - run as shell command
      try {
        const altResult = await this.sandbox.runCommand({
          cmd: 'sh',
          args: ['-c', 'cd /vercel/sandbox && npm install'],
          cwd: '/vercel/sandbox'
        });
        if (altResult.exitCode === 0) {
          // Alternative npm install succeeded
        } else {
          console.warn('[VercelProvider] Alternative npm install also had issues:', altResult.stderr);
        }
      } catch (altError) {
        console.error('[VercelProvider] Alternative npm install also failed:', altError);
        console.warn('[VercelProvider] Continuing without npm install - packages may need to be installed manually');
      }
    }
    
    // Start Vite dev server
    // Starting Vite dev server
    
    // Kill any existing Vite processes
    await this.sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', 'pkill -f vite || true'],
      cwd: '/'
    });
    
    // Start Vite in background
    await this.sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', 'nohup npm run dev > /tmp/vite.log 2>&1 &'],
      cwd: '/vercel/sandbox'
    });
    
    // Vite server started in background
    
    // Wait for Vite to be ready
    await new Promise(resolve => setTimeout(resolve, 7000));
    
    // Track initial files
    this.existingFiles.add('src/App.jsx');
    this.existingFiles.add('src/main.jsx');
    this.existingFiles.add('src/index.css');
    this.existingFiles.add('index.html');
    this.existingFiles.add('package.json');
    this.existingFiles.add('vite.config.js');
    this.existingFiles.add('tailwind.config.js');
    this.existingFiles.add('postcss.config.js');
  }

  async restartViteServer(): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    // Restarting Vite server
    
    // Kill existing Vite process
    await this.sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', 'pkill -f vite || true'],
      cwd: '/'
    });
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Start Vite in background
    await this.sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', 'nohup npm run dev > /tmp/vite.log 2>&1 &'],
      cwd: '/vercel/sandbox'
    });
    
    // Vite server started in background
    
    // Wait for Vite to be ready
    await new Promise(resolve => setTimeout(resolve, 7000));
  }

  getSandboxUrl(): string | null {
    return this.sandboxInfo?.url || null;
  }

  getSandboxInfo(): SandboxInfo | null {
    return this.sandboxInfo;
  }

  async terminate(): Promise<void> {
    if (this.sandbox) {
      try {
        await this.sandbox.stop();
      } catch (e) {
        console.error('Failed to terminate sandbox:', e);
      }
      this.sandbox = null;
      this.sandboxInfo = null;
    }
  }

  isAlive(): boolean {
    return !!this.sandbox;
  }
}