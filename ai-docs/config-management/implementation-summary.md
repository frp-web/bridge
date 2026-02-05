# 配置管理功能实施总结

## 已完成的工作

### 1. frp-bridge 库扩展

在 `packages/frp-bridge/src/` 目录下创建了配置管理核心模块：

#### 文件：`preset-config.ts`
- 定义了 `PresetConfig` 接口
- 定义了 `FrpsPresetConfig` 和 `FrpcPresetConfig` 接口
- 提供了默认预设配置 `DEFAULT_PRESET_CONFIG`

**预设配置项**：
- **frps**: bindPort, vhostHTTPPort, domain, dashboardPort, dashboardUser, dashboardPassword
- **frpc**: serverAddr, serverPort, authToken

#### 文件：`config-merger.ts`
- 实现了 `mergeConfigs()` 函数：合并预设配置和用户配置
- 实现了 `extractProxiesSection()` 函数：提取用户配置中的代理部分
- 实现了 `configToToml()` 函数：将配置对象转换为 TOML 格式
- 实现了 `validatePresetConfig()` 函数：验证预设配置

**合并逻辑**：
```typescript
// 1. 预设配置的基础参数放在前面
// 2. 用户配置的 [[proxies]] 部分追加在后面
// 3. 生成最终的 TOML 配置字符串
```

### 2. frp-web 前端界面

在 `app/pages/config/-components/tabs/` 目录下创建了预设配置界面：

#### 文件：`preset.vue`
- 预设配置主页面
- 包含 FRPS 和 FRPC 两个标签页
- 实现配置的加载和保存功能
- 使用 `useStorage()` 存储到 `frp:preset-config` 键

#### 文件：`preset/FrpsConfigForm.vue`
- FRPS 预设配置表单
- 包含：绑定端口、HTTP 端口、服务器域名、Dashboard 配置
- 带有输入提示和默认值

#### 文件：`preset/FrpcConfigForm.vue`
- FRPC 预设配置表单
- 包含：服务器地址、服务器端口、认证令牌
- 带有输入提示和默认值

#### 文件：`tabs/index.vue` (更新)
- 添加了"预设配置"标签页
- 位置在"常规设置"和"FRP 配置"之间

## 功能说明

### 预设配置页面访问路径
1. 打开 frp-web
2. 进入"配置"页面
3. 点击"预设配置"标签

### 使用流程
1. **编辑预设配置**
   - 切换到 FRPS 或 FRPC 标签
   - 修改相应的配置项
   - 点击"保存配置"按钮

2. **配置存储**
   - 预设配置保存在 `frp:preset-config` 键下
   - 使用 Nuxt 的 `useStorage()` 进行存储

3. **配置合并**（后续集成）
   - 在启动 frp 前，读取预设配置
   - 读取用户配置（原有的代理配置）
   - 调用 `mergeConfigs()` 合并
   - 使用合并后的配置启动 frp

## 配置合并示例

### 预设配置
```toml
bindPort = 7000
vhostHTTPPort = 7000
domain = "example.com"
```

### 用户配置（原有）
```toml
[[proxies]]
name = "ssh"
type = "tcp"
localPort = 22
remotePort = 6000
```

### 合并后的配置
```toml
bindPort = 7000
vhostHTTPPort = 7000
domain = "example.com"

[[proxies]]
name = "ssh"
type = "tcp"
localPort = 22
remotePort = 6000
```

## 数据流

```
┌─────────────────────────────────────────────────────────┐
│                     frp-web                             │
│                                                           │
│  ┌────────────────────────────────────────────────┐     │
│  │  预设配置页面                                     │     │
│  │  - 用户编辑表单                                   │     │
│  │  - 保存到 storage (frp:preset-config)           │     │
│  └────────────────────────────────────────────────┘     │
│                                                           │
│  ┌────────────────────────────────────────────────┐     │
│  │  原有配置页面                                     │     │
│  │  - 用户配置代理                                   │     │
│  │  - 保存到原有位置                                 │     │
│  └────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   frp-bridge                             │
│                                                           │
│  启动流程：                                               │
│  1. 读取预设配置 → PresetConfig                         │
│  2. 读取用户配置 → string (TOML)                         │
│  3. 调用 mergeConfigs(preset, user, type)               │
│  4. 获得最终配置 → string (TOML)                        │
│  5. 启动 frp                                            │
└─────────────────────────────────────────────────────────┘
```

## 验证清单

在继续之前，请验证以下内容：

- [ ] frp-bridge 库构建成功（`pnpm run build`）
- [ ] frp-web 可以正常启动（`pnpm run dev`）
- [ ] 配置页面可以访问 `/config`
- [ ] 可以看到"预设配置"标签
- [ ] 可以编辑并保存预设配置
- [ ] 刷新页面后预设配置保持不变

## 后续集成任务

### 任务 1：在启动流程中集成配置合并

需要修改 frp 启动的相关代码，在启动前：
1. 读取预设配置
2. 读取用户配置
3. 调用 `mergeConfigs()`
4. 使用合并后的配置启动

**位置**：frp-web 的 server 端，或 frp-bridge 的启动逻辑

### 任务 2：添加预设配置 API（可选）

如果需要通过 API 管理预设配置，可以添加：
- `GET /api/config/preset` - 获取预设配置
- `POST /api/config/preset` - 保存预设配置

### 任务 3：配置预览功能（可选）

在预设配置页面添加"预览"按钮：
- 显示合并后的最终配置
- 方便用户检查配置是否正确

## 注意事项

1. **现有功能不受影响**
   - 原有的配置管理功能完全保持不变
   - 只是添加了一个新的预设配置标签

2. **向后兼容**
   - 如果没有预设配置，使用默认值
   - 如果预设配置不完整，只填充提供的字段

3. **数据独立性**
   - 预设配置独立存储
   - 用户配置保持原有存储方式

## 测试建议

### 功能测试
1. 测试预设配置保存
2. 测试预设配置加载
3. 测试配置合并方法
4. 测试边界情况（空配置、部分配置等）

### 集成测试
1. 测试启动流程中的配置合并
2. 测试 frp 启动是否使用正确配置
3. 测试配置修改后的重启

## 完成状态

- ✅ 预设配置定义
- ✅ 配置合并方法
- ✅ 前端界面
- ⏳ 启动流程集成（待完成）
- ⏳ 测试验证（待完成）
