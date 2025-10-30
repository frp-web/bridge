# frp-bridge

FRP bridge toolkit - A modern TypeScript wrapper for [frp](https://github.com/fatedier/frp).

## Features

- 🚀 **Modern TypeScript** - Full type safety and IntelliSense support
- 📦 **Monorepo Architecture** - Modular design with separate packages
- 🛠️ **CLI & API** - Use as a command-line tool or integrate into your app
- 🔄 **Lifecycle Management** - Easy start/stop/restart of frp services
- 📝 **Config Management** - Type-safe configuration with backup support
- ⚡ **Auto Download** - Automatically downloads latest frp binaries
- 🌍 **Cross-Platform** - Works on Linux, macOS, and Windows

## Packages

- `@frp-bridge/core` - Core functionality and FrpBridge class
- `@frp-bridge/types` - TypeScript type definitions for frp configs
- `@frp-bridge/shared` - Shared utilities (loading spinner, etc.)
- `frpx` - Command-line interface
- `frp-bridge` - Aggregated exports (recommended)

## Installation

```bash
# Install globally for CLI usage
pnpm add -g frpx

# Or install as a dependency
pnpm add frp-bridge
```

## CLI Usage

```bash
# Download latest frp binary
frpx download --mode client

# Download specific version
frpx download --mode client --version 0.65.0

# Start frp client with config file
frpx start ./frpc.json --mode client

# Backup current configuration
frpx backup --mode client
```

## Programmatic Usage

```typescript
import { FrpBridge } from 'frp-bridge'

// Create client instance (auto-detects latest version)
const bridge = new FrpBridge({ mode: 'client' })

// Or specify version
const bridge = new FrpBridge({
  mode: 'client',
  version: '0.65.0'
})

// Set configuration
bridge.updateConfig({
  serverAddr: 'frp.example.com',
  serverPort: 7000,
  auth: { token: 'your-token' }
})

// Start service (auto-downloads binary if needed)
await bridge.start()

// Check if running
console.log(bridge.isRunning())

// Stop service
await bridge.stop()
```

## Configuration Example

### Client Configuration (frpc.json)

```json
{
  "serverAddr": "frp.example.com",
  "serverPort": 7000,
  "auth": {
    "token": "your-secret-token"
  },
  "transport": {
    "protocol": "tcp"
  },
  "log": {
    "to": "./frpc.log",
    "level": "info"
  },
  "proxies": [
    {
      "name": "ssh",
      "type": "tcp",
      "localIP": "127.0.0.1",
      "localPort": 22,
      "remotePort": 6000
    },
    {
      "name": "web",
      "type": "http",
      "localIP": "127.0.0.1",
      "localPort": 8080,
      "customDomains": ["web.example.com"]
    }
  ]
}
```

### Server Configuration (frps.json)

```json
{
  "bindAddr": "0.0.0.0",
  "bindPort": 7000,
  "auth": {
    "token": "your-secret-token"
  },
  "log": {
    "to": "./frps.log",
    "level": "info"
  },
  "webServer": {
    "addr": "0.0.0.0",
    "port": 7500,
    "user": "admin",
    "password": "admin"
  }
}
```

## API Reference

### FrpBridge Class

```typescript
class FrpBridge {
  constructor(options: FrpBridgeOptions)

  // Binary management
  async downloadFrpBinary(): Promise<void>
  async updateFrpBinary(newVersion?: string): Promise<void>
  hasBinary(): boolean

  // Process management
  async start(): Promise<void>
  async stop(): Promise<void>
  isRunning(): boolean

  // Config management
  getConfig(): ClientConfig | ServerConfig | null
  updateConfig(config: Partial<ClientConfig | ServerConfig>): void
  async backupConfig(): Promise<string>

  // Node management (client mode)
  addNode(node: NodeInfo): void
  updateNode(node: NodeInfo): void
  removeNode(): void
  getNode(): NodeInfo | null

  // Tunnel management (client mode)
  addTunnel(proxy: ProxyConfig): void
  updateTunnel(name: string, proxy: Partial<ProxyConfig>): void
  removeTunnel(name: string): void
  getTunnel(name: string): ProxyConfig | null
  listTunnels(): ProxyConfig[]
}
```

### Types

```typescript
interface FrpBridgeOptions {
  workDir?: string // Default: ~/.frp-bridge
  version?: string // Default: latest from GitHub
  mode: 'client' | 'server'
}

interface NodeInfo {
  id: string
  name: string
  serverAddr: string
  serverPort?: number
  token?: string
  config?: Partial<ClientConfig | ServerConfig>
}
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run CLI in dev mode (with stub)
pnpm stub
pnpm frpx

# Lint code
pnpm lint

# Fix lint issues
pnpm lint --fix
```

## Architecture

```
frp-bridge/
├── packages/
│   ├── types/          # TypeScript definitions
│   ├── core/           # Core FrpBridge class
│   ├── shared/         # Shared utilities
│   ├── cli/            # CLI tool (frpx)
│   └── frp-bridge/     # Main package
├── scripts/            # Build scripts
└── ai-docs/            # AI documentation
```

## License

MIT
