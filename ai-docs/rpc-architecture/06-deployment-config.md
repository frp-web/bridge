# 部署配置

frps 和 frpc 的完整部署配置示例。

## 目录结构

```
project/
├── frps/
│   ├── docker-compose.yml
│   ├── frps.toml
│   ├── .env
│   └── nuxt/
│       ├── server/
│       │   └── api/
│       │       └── rpc/
│       │           └── ws.ts
│       └── nuxt.config.ts
│
└── frpc/
    ├── docker-compose.yml
    ├── .env
    └── nuxt/
        ├── composables/
        │   └── useRpcChannel.ts
        └── plugins/
            └── rpc.client.ts
```

## frps 配置

### frps.toml

```toml
# frps.toml - frps 服务端配置

# 基础配置
bindPort = 7000
vhostHTTPPort = 7000

# 认证配置（可选）
# auth.token = "your-secret-token"

# 仪表板配置（可选）
webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "admin"

# 配置 frps Nuxt 代理
[[proxies]]
name = "frps-nuxt"
type = "http"
localIP = "127.0.0.1"
localPort = 3000
customDomains = [ "your-domain.com" ]

# 日志配置
log.level = "info"
log.to = "/var/log/frps.log"
log.maxDays = 3
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  frps:
    image: snowdreamtech/frps:0.52.3
    container_name: frps
    restart: unless-stopped
    ports:
      - '7000:7000' # HTTP/WebSocket 端口
      - '7500:7500' # 仪表板端口（可选）
    volumes:
      - ./frps.toml:/etc/frp/frps.toml:ro
      - ./logs:/var/log/frps
    environment:
      - TZ=Asia/Shanghai
    networks:
      - frp-network

  nuxt:
    build:
      context: ./nuxt
      dockerfile: Dockerfile
    container_name: frps-nuxt
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - NUXT_PUBLIC_API_BASE_URL=https://your-domain.com
    volumes:
      - ./nuxt:/app
      - /app/node_modules
      - /app/.nuxt
    networks:
      - frp-network
    depends_on:
      - frps

networks:
  frp-network:
    driver: bridge
```

### .env

```bash
# frps 配置
DOMAIN=your-domain.com
FRPS_PORT=7000

# Nuxt 配置
NODE_ENV=production
NUXT_PUBLIC_API_BASE_URL=https://your-domain.com

# RPC 配置（可选）
RPC_SECRET=your-rpc-secret-key
```

### Dockerfile (frps Nuxt)

```dockerfile
# frps/nuxt/Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "preview"]
```

## frpc 配置

### docker-compose.yml

```yaml
version: '3.8'

services:
  frpc-bridge:
    build:
      context: ./nuxt
      dockerfile: Dockerfile
    container_name: frpc-bridge
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - RPC_SERVER_URL=ws://your-domain.com:7000/api/rpc/ws
      - RPC_NODE_ID=frpc-prod-01
      - RPC_RECONNECT_DELAY=5000
    volumes:
      - ./nuxt:/app
      - /app/node_modules
      - /app/.nuxt
      - ./logs:/app/logs
    networks:
      - frp-network
    dns:
      - 8.8.8.8
      - 8.8.4.4

networks:
  frp-network:
    driver: bridge
```

### .env

```bash
# RPC 客户端配置
RPC_SERVER_URL=ws://your-domain.com:7000/api/rpc/ws
RPC_NODE_ID=frpc-prod-01
RPC_RECONNECT_DELAY=5000

# 本地服务配置
LOCAL_SERVICES_ROOT=/app/services
LOG_LEVEL=info

# 调试
RPC_DEBUG=false
```

### Dockerfile (frpc Nuxt)

```dockerfile
# frpc/nuxt/Dockerfile
FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci

# 复制源码
COPY . .

# 构建应用
RUN npm run build

EXPOSE 3000

# 启动应用
CMD ["npm", "run", "start"]
```

## Nuxt 配置

### frps Nuxt 配置

```typescript
// frps/nuxt/nuxt.config.ts
export default defineNuxtConfig({
  // 服务端配置
  server: {
    port: 3000,
    host: '0.0.0.0'
  },

  // 运行时配置
  runtimeConfig: {
    // 私有配置（服务端）
    rpcSecret: process.env.RPC_SECRET,
    adminApiKey: process.env.ADMIN_API_KEY,

    // 公共配置（客户端）
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL
    }
  },

  // 服务端渲染
  ssr: true,

  // 模块
  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt'
  ],

  // WebSocket 支持
  nitro: {
    experimental: {
      websocket: true
    }
  },

  // 安全配置
  security: {
    csrf: {
      enabled: true
    }
  },

  // 日志配置
  logLevel: process.env.LOG_LEVEL || 'info'
})
```

### frpc Nuxt 配置

```typescript
// frpc/nuxt/nuxt.config.ts
export default defineNuxtConfig({
  // 服务端配置
  server: {
    port: 3000,
    host: '0.0.0.0'
  },

  // 运行时配置
  runtimeConfig: {
    rpcServerUrl: process.env.RPC_SERVER_URL || 'ws://localhost:7000/api/rpc/ws',
    rpcReconnectDelay: Number.parseInt(process.env.RPC_RECONNECT_DELAY || '5000'),
    rpcDebug: process.env.RPC_DEBUG === 'true',

    public: {
      rpcNodeId: process.env.RPC_NODE_ID || 'frpc-dev'
    }
  },

  // 服务端渲染
  ssr: true,

  // 模块
  modules: [
    '@pinia/nuxt'
  ],

  // 日志配置
  logLevel: process.env.LOG_LEVEL || 'info'
})
```

## 部署步骤

### 1. 准备服务器

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 安装 Docker Compose
sudo apt install docker-compose -y

# 创建项目目录
mkdir -p ~/frp-deployment
cd ~/frp-deployment
```

### 2. 部署 frps

```bash
# 创建 frps 目录
mkdir -p frps/{logs,nuxt}

# 复制配置文件
scp frps.toml user@server:~/frp-deployment/frps/
scp docker-compose.frps.yml user@server:~/frp-deployment/frps/docker-compose.yml
scp .env.frps user@server:~/frp-deployment/frps/.env

# 在服务器上启动
cd ~/frp-deployment/frps
docker-compose up -d

# 检查状态
docker-compose ps
docker-compose logs -f
```

### 3. 部署 frpc

```bash
# 创建 frpc 目录
mkdir -p frpc/{logs,nuxt}

# 复制配置文件
scp docker-compose.frpc.yml user@client:~/frp-deployment/frpc/docker-compose.yml
scp .env.frpc user@client:~/frp-deployment/frpc/.env

# 在客户端上启动
cd ~/frp-deployment/frpc
docker-compose up -d

# 检查状态
docker-compose ps
docker-compose logs -f rpc-client
```

### 4. 验证连接

```bash
# 检查 frps 日志
docker-compose logs -f frps

# 检查 frpc 日志
docker-compose logs -f frpc-bridge

# 应该看到类似输出：
# [RPC Client] Connected to server as frpc-prod-01
# [RPC] Node connected: frpc-prod-01
```

## 生产环境配置

### Nginx 反向代理（可选）

```nginx
# /etc/nginx/sites-available/frps
server {
    listen 80;
    server_name your-domain.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 配置
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # WebSocket 支持
    location /api/rpc/ws {
        proxy_pass http://127.0.0.1:7000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时配置
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }

    # HTTP 请求
    location / {
        proxy_pass http://127.0.0.1:7000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 防火墙配置

```bash
# UFW (Ubuntu)
sudo ufw allow 7000/tcp
sudo ufw allow 7500/tcp  # 仪表板
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 80/tcp    # HTTP
sudo ufw enable

# firewalld (CentOS)
sudo firewall-cmd --permanent --add-port=7000/tcp
sudo firewall-cmd --permanent --add-port=7500/tcp
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 系统服务配置

```ini
# /etc/systemd/system/frps-nuxt.service
[Unit]
Description=FRPS Nuxt Application
After=network.target docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/user/frp-deployment/frps
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```bash
# 启用服务
sudo systemctl enable frps-nuxt
sudo systemctl start frps-nuxt
sudo systemctl status frps-nuxt
```

## 监控和日志

### 日志配置

```typescript
// server/utils/logger.ts
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'

const logDir = join(process.cwd(), 'logs')
const logFile = join(logDir, `rpc-${new Date().toISOString().split('T')[0]}.log`)

export const logger = {
  info(message: string, data?: any) {
    const log = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      data
    }

    console.log(JSON.stringify(log))
    // 写入文件
    createWriteStream(logFile, { flags: 'a' }).write(`${JSON.stringify(log)}\n`)
  },

  error(message: string, error?: any) {
    const log = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      error: error?.message || error
    }

    console.error(JSON.stringify(log))
    createWriteStream(logFile, { flags: 'a' }).write(`${JSON.stringify(log)}\n`)
  }
}
```

### 健康检查

```typescript
// server/api/health.get.ts
import { getOnlineNodes } from '../api/rpc/ws'

export default defineEventHandler((event) => {
  const onlineNodes = getOnlineNodes()

  return {
    status: 'healthy',
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    rpc: {
      onlineNodes: onlineNodes.length,
      nodes: onlineNodes
    }
  }
})
```

### Prometheus 监控（可选）

```typescript
// server/metrics.ts
import { Counter, Gauge, register } from 'prom-client'

export const rpcCommandsSent = new Counter({
  name: 'rpc_commands_sent_total',
  help: 'Total number of RPC commands sent',
  labelNames: ['action', 'node_id']
})

export const rpcEventsReceived = new Counter({
  name: 'rpc_events_received_total',
  help: 'Total number of RPC events received',
  labelNames: ['action', 'node_id']
})

export const onlineNodesGauge = new Gauge({
  name: 'rpc_online_nodes',
  help: 'Number of currently online nodes'
})

export { register }
```

## 备份和恢复

### 配置备份

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backup/frps"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# 备份配置文件
tar -czf "$BACKUP_DIR/frps-$DATE.tar.gz" \
  /home/user/frp-deployment/frps/frps.toml \
  /home/user/frp-deployment/frps/.env \
  /home/user/frp-deployment/frps/logs

# 保留最近 7 天的备份
find "$BACKUP_DIR" -name "frps-*.tar.gz" -mtime +7 -delete

echo "Backup completed: frps-$DATE.tar.gz"
```

### 定时备份

```bash
# 添加到 crontab
crontab -e

# 每天凌晨 2 点备份
0 2 * * * /home/user/backup.sh
```

## 故障排查

### 常见问题

#### 1. WebSocket 连接失败

```bash
# 检查端口是否开放
netstat -tlnp | grep 7000

# 检查防火墙
sudo ufw status

# 测试连接
wscat -c ws://your-domain.com:7000/api/rpc/ws?nodeId=test
```

#### 2. 节点频繁断线

```typescript
// 增加心跳间隔
const reconnectDelay = 10000 // 10 秒

// 启用心跳
ws.on('open', () => {
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
    }
  }, 30000) // 30 秒心跳
})
```

#### 3. 消息丢失

```typescript
// 添加消息确认机制
async function sendWithAck(message: any, timeout = 5000): Promise<any> {
  const messageId = message.id || crypto.randomUUID()
  message.id = messageId

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout waiting for acknowledgment'))
    }, timeout)

    const handler = (data: any) => {
      const msg = JSON.parse(data.toString())
      if (msg.id === messageId) {
        clearTimeout(timer)
        ws.off('message', handler)
        resolve(msg.payload)
      }
    }

    ws.on('message', handler)
    ws.send(JSON.stringify(message))
  })
}
```

## 安全建议

### 1. 使用环境变量

```bash
# 不要在代码中硬编码敏感信息
RPC_SECRET=your-secret-key
ADMIN_API_KEY=your-api-key
```

### 2. 启用 HTTPS

```nginx
# 使用 Let's Encrypt 免费证书
sudo certbot --nginx -d your-domain.com
```

### 3. 限制访问

```typescript
// server/middleware/rate-limit.ts
const rateLimit = new Map()

export default defineEventHandler((event) => {
  const ip = event.node.req.headers['x-forwarded-for'] || event.node.req.socket.remoteAddress

  if (!rateLimit.has(ip)) {
    rateLimit.set(ip, { count: 0, resetTime: Date.now() + 60000 })
  }

  const record = rateLimit.get(ip)

  if (Date.now() > record.resetTime) {
    record.count = 0
    record.resetTime = Date.now() + 60000
  }

  if (record.count > 100) {
    throw createError({ statusCode: 429, message: 'Too many requests' })
  }

  record.count++
})
```

### 4. 日志脱敏

```typescript
function sanitizeLog(data: any): any {
  const sensitive = ['password', 'token', 'secret', 'key']

  if (typeof data === 'string') {
    return data.replace(/\/token\/[^/]+/g, '/token/***')
  }

  if (typeof data === 'object' && data !== null) {
    const sanitized = { ...data }

    for (const key of Object.keys(sanitized)) {
      if (sensitive.some(s => key.toLowerCase().includes(s))) {
        sanitized[key] = '***'
      }
    }

    return sanitized
  }

  return data
}
```
