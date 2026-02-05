# 配置管理方案

## 需求背景

当前的 frp-bridge 直接读取 frps/frpc 的配置文件。现在需要改进为：

1. **预设配置（系统配置）**：系统级配置，用户不能直接修改文件，只能通过 frp-web 的特定表单设置
   - 例如：`vhostHTTPPort = 7000` 等基础配置
   - 这些配置在 frp-web 中有专门的表单页面

2. **用户配置**：用户可编辑的代理配置
   - 例如：具体的隧道、代理规则
   - 这是用户原本在 frp-web 中编辑的配置

3. **配置合并**：在启动 frp 前，将预设配置和用户配置合并成最终的配置文件

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                     frp-web (前端)                        │
│                                                           │
│  ┌─────────────────────┐      ┌─────────────────────┐  │
│  │   原有配置页面       │      │  新增：预设配置页面   │  │
│  │  - 代理管理          │      │  - 基础设置           │  │
│  │  - 隧道配置          │      │  - 端口配置           │  │
│  │  (用户配置)          │      │  - 系统参数           │  │
│  └──────────┬──────────┘      └──────────┬──────────┘  │
│             │                              │            │
│             └──────────┬───────────────────┘            │
│                        │                                │
│                   通过 API 保存                          │
└────────────────────────┼────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   frp-bridge (后端)                       │
│                                                           │
│  ┌────────────────────────────────────────────────┐     │
│  │            配置存储                              │     │
│  │  - 预设配置（独立存储）                          │     │
│  │  - 用户配置（原有存储方式）                      │     │
│  └────────────────────────────────────────────────┘     │
│                         │                                │
│                         ▼                                │
│  ┌────────────────────────────────────────────────┐     │
│  │           配置合并方法（新增）                   │     │
│  │  mergeConfigs(presetConfig, userConfig)        │     │
│  │    → 生成最终的 frp.toml                       │     │
│  └────────────────────────────────────────────────┘     │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

## 实现步骤

### 步骤 1：定义预设配置结构

在 frp-bridge 中定义预设配置的数据结构和默认值。

**位置**：`packages/frp-bridge/src/preset-config.ts`

```typescript
// 预设配置定义
export interface PresetConfig {
  // frps 预设配置
  frps?: {
    bindPort?: number
    vhostHTTPPort?: number
    // ... 其他系统级配置
  }

  // frpc 预设配置
  frpc?: {
    serverAddr?: string
    serverPort?: number
    // ... 其他系统级配置
  }
}

// 默认预设配置
export const DEFAULT_PRESET_CONFIG: PresetConfig = {
  frps: {
    bindPort: 7000,
    vhostHTTPPort: 7000
  },
  frpc: {
    serverPort: 7000
  }
}
```

### 步骤 2：实现配置合并方法

在 frp-bridge 中添加配置合并的工具方法。

**位置**：`packages/frp-bridge/src/config-merger.ts`

```typescript
export function mergeConfigs(
  presetConfig: PresetConfig,
  userConfig: UserConfig,
  type: 'frps' | 'frpc'
): string {
  // 1. 合并预设配置和用户配置
  // 2. 生成 TOML 格式的配置字符串
  // 3. 返回最终配置
}
```

### 步骤 3：在 frp-web 中添加预设配置界面

在现有的配置页面基础上，添加预设配置的编辑表单。

**位置**：`frp-web/app/pages/config/preset.vue`

这是一个新的页面，包含：
- 基础设置表单（端口、域名等）
- 保存到预设配置存储

### 步骤 4：修改启动流程

在 frp 启动前，调用配置合并方法，使用合并后的配置。

**位置**：`packages/frp-bridge/src/launcher.ts`（或相应的启动文件）

```typescript
// 原来的流程：
// 1. 读取配置文件
// 2. 启动 frp

// 新流程：
// 1. 读取预设配置
// 2. 读取用户配置
// 3. 合并配置 → 生成最终配置
// 4. 将最终配置写入临时文件或直接传递
// 5. 启动 frp
```

## 关键点

1. **不影响现有功能**：用户配置的读取和编辑方式不变
2. **预设配置独立存储**：与用户配置分开存储
3. **只在启动时合并**：合并发生在 frp 启动前，生成最终配置文件
4. **向后兼容**：如果没有预设配置，使用默认值

## 文件变更清单

### 需要修改的文件

1. **frp-bridge**：
   - 新增 `src/preset-config.ts` - 预设配置定义
   - 新增 `src/config-merger.ts` - 配置合并方法
   - 修改 `src/launcher.ts` - 启动流程中调用合并方法

2. **frp-web**：
   - 新增 `app/pages/config/preset.vue` - 预设配置页面
   - 修改 `app/stores/config.ts` - 添加预设配置的读写方法

### 不需要修改的文件

- 现有的用户配置管理功能
- 现有的代理、隧道管理功能
- 现有的配置文件读取逻辑

## 数据存储

### 预设配置存储

```jsonc
// 存储位置示例
{
  "preset": {
    "frps": {
      "bindPort": 7000,
      "vhostHTTPPort": 7000,
      "domain": "example.com"
    }
  }
}
```

### 用户配置存储

保持不变，继续使用原有的存储方式。

## 示例流程

### 用户操作流程

1. 用户打开 frp-web
2. 进入"预设配置"页面，设置 `vhostHTTPPort = 7000`
3. 进入"代理管理"页面，添加隧道配置
4. 启动 frp
5. 系统自动合并预设配置和用户配置
6. 生成最终的配置文件并启动

### 配置合并示例

**预设配置**：
```toml
bindPort = 7000
vhostHTTPPort = 7000
```

**用户配置**：
```toml
[[proxies]]
name = "ssh"
type = "tcp"
localPort = 22
remotePort = 6000
```

**合并后**：
```toml
bindPort = 7000
vhostHTTPPort = 7000

[[proxies]]
name = "ssh"
type = "tcp"
localPort = 22
remotePort = 6000
```
