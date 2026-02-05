# 配置合并逻辑

## 合并方法

在 frp-bridge 中添加配置合并方法：

```typescript
// packages/frp-bridge/src/config-merger.ts

import type { PresetConfig } from './preset-config'

/**
 * 合并预设配置和用户配置，生成最终的 TOML 配置
 */
export function mergeConfigs(
  presetConfig: PresetConfig,
  userConfig: string, // 用户配置的 TOML 字符串
  type: 'frps' | 'frpc'
): string {
  // 1. 解析用户配置 TOML
  const userConfigObj = parseToml(userConfig)

  // 2. 合并预设配置
  const finalConfig = {
    ...presetConfig[type],
    ...userConfigObj
  }

  // 3. 生成最终的 TOML 字符串
  return generateToml(finalConfig)
}

/**
 * 解析 TOML 字符串为对象
 */
function parseToml(toml: string): any {
  // 使用 toml 解析库
  // 或简单的字符串解析
}

/**
 * 生成 TOML 字符串
 */
function generateToml(config: any): string {
  // 将配置对象转换为 TOML 格式
}
```

## 合并规则

1. **预设配置优先级高**：预设配置的基础参数会覆盖用户配置中的同名参数
2. **用户配置的代理保留**：用户配置的 `[[proxies]]` 部分完全保留
3. **数组合并**：如果有数组类型的配置（如 proxies），进行合并而非覆盖

## 使用示例

```typescript
import { mergeConfigs } from 'frp-bridge'

// 预设配置
const presetConfig = {
  frps: {
    bindPort: 7000,
    vhostHTTPPort: 7000,
    domain: 'example.com'
  }
}

// 用户配置
const userConfig = `
[[proxies]]
name = "ssh"
type = "tcp"
localPort = 22
remotePort = 6000
`

// 合并
const finalConfig = mergeConfigs(presetConfig, userConfig, 'frps')

// 结果：
// bindPort = 7000
// vhostHTTPPort = 7000
//
// [[proxies]]
// name = "ssh"
// type = "tcp"
// localPort = 22
// remotePort = 6000
```

## 在启动流程中使用

```typescript
// packages/frp-bridge/src/launcher.ts

export async function launchFrp(type: 'frps' | 'frpc') {
  // 1. 读取预设配置
  const presetConfig = await loadPresetConfig()

  // 2. 读取用户配置
  const userConfig = await loadUserConfig(type)

  // 3. 合并配置
  const finalConfig = mergeConfigs(presetConfig, userConfig, type)

  // 4. 写入临时配置文件
  const tempConfigPath = writeTempConfig(finalConfig, type)

  // 5. 启动 frp
  await startFrpProcess(tempConfigPath)
}
```
