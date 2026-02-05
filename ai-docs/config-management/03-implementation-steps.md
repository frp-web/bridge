# 实施步骤

## 阶段 1：frp-bridge 核心功能

### 1.1 创建预设配置定义

**文件**：`packages/frp-bridge/src/preset-config.ts`

```typescript
export interface PresetConfig {
  frps?: {
    bindPort?: number
    vhostHTTPPort?: number
    domain?: string
    dashboardPort?: number
    dashboardUser?: string
    dashboardPassword?: string
  }
  frpc?: {
    serverAddr?: string
    serverPort?: number
    authToken?: string
  }
}

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

### 1.2 实现配置合并方法

**文件**：`packages/frp-bridge/src/config-merger.ts`

- 实现 `mergeConfigs()` 函数
- 实现 TOML 解析和生成
- 导出合并方法

### 1.3 修改启动流程

**文件**：`packages/frp-bridge/src/launcher.ts`（或相应的启动文件）

- 在启动前调用配置合并
- 使用合并后的配置启动 frp

## 阶段 2：frp-web 前端界面

### 2.1 创建预设配置页面

**文件**：`app/pages/config/preset.vue`

- 创建预设配置表单
- 支持编辑和保存预设配置
- 与现有配置页面风格一致

### 2.2 更新配置 Store

**文件**：`app/stores/config.ts`

- 添加预设配置的读取方法
- 添加预设配置的保存方法

## 阶段 3：集成和测试

### 3.1 集成测试

- 测试预设配置保存
- 测试配置合并
- 测试启动流程

### 3.2 用户测试

- 验证现有功能不受影响
- 验证新功能正常工作

## 文件清单

### 新增文件

1. `packages/frp-bridge/src/preset-config.ts` - 预设配置定义
2. `packages/frp-bridge/src/config-merger.ts` - 配置合并方法
3. `app/pages/config/preset.vue` - 预设配置页面

### 修改文件

1. `packages/frp-bridge/src/launcher.ts` - 启动流程中调用合并
2. `app/stores/config.ts` - 添加预设配置读写方法

### 不修改的文件

- 现有的用户配置管理功能
- 现有的代理、隧道管理
- 现有的配置文件读取逻辑

## 验收标准

- [ ] 预设配置可以正常保存和读取
- [ ] 配置合并正确生成最终配置
- [ ] frp 启动时使用合并后的配置
- [ ] 现有功能不受影响
- [ ] 用户界面友好易用
