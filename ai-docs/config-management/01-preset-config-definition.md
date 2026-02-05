# 预设配置定义

## 预设配置项

### frps 预设配置

| 配置项 | 类型 | 默认值 | 说明 | 是否必填 |
|--------|------|--------|------|----------|
| `bindPort` | number | 7000 | 绑定端口 | 是 |
| `vhostHTTPPort` | number | 7000 | HTTP 虚拟主机端口 | 是 |
| `domain` | string | - | 服务器域名 | 是 |
| `dashboardPort` | number | 7500 | Dashboard 端口 | 否 |
| `dashboardUser` | string | admin | Dashboard 用户名 | 否 |
| `dashboardPassword` | string | - | Dashboard 密码 | 否 |

### frpc 预设配置

| 配置项 | 类型 | 默认值 | 说明 | 是否必填 |
|--------|------|--------|------|----------|
| `serverAddr` | string | - | 服务器地址 | 是 |
| `serverPort` | number | 7000 | 服务器端口 | 是 |
| `auth_token` | string | - | 认证令牌 | 否 |

## 数据结构

```typescript
export interface PresetConfig {
  // frps 预设配置
  frps?: {
    bindPort?: number
    vhostHTTPPort?: number
    domain?: string
    dashboardPort?: number
    dashboardUser?: string
    dashboardPassword?: string
  }

  // frpc 预设配置
  frpc?: {
    serverAddr?: string
    serverPort?: number
    authToken?: string
  }
}
```

## 存储格式

预设配置存储在独立的文件或数据库中，与用户配置分离。

### 示例存储结构

```json
{
  "preset": {
    "frps": {
      "bindPort": 7000,
      "vhostHTTPPort": 7000,
      "domain": "example.com"
    },
    "frpc": {
      "serverPort": 7000
    }
  }
}
```

## 默认值

当没有预设配置时，使用以下默认值：

```typescript
export const DEFAULT_PRESET_CONFIG: PresetConfig = {
  frps: {
    bindPort: 7000,
    vhostHTTPPort: 7000,
    dashboardPort: 7500,
    dashboardUser: 'admin'
  },
  frpc: {
    serverPort: 7000
  }
}
```
