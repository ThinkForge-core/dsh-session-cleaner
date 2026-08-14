# dsh-session-cleaner

从**运行中的** DeepSeek Harness Web 运行时删除会话——文件、内存 live store、工作区记录，无需重启 `dsh web`。

官方 Web API 只有 `workspace.archiveSession`（隐藏），没有 `session.delete`。本 bundle 补上这个缺口。

## 安装

```sh
dsh plugin --profile web add dsh-session-cleaner            # 从 npm
dsh plugin --profile web add github:fountunt/dsh-session-cleaner   # 从 git

# 或使用本地 checkout
dsh plugin --profile web add file:/path/to/dsh-session-cleaner
```

然后重启 `dsh web`（运行中的实例不会热加载新 bundle）。

## 使用

### Web UI（v0.2.0+）

客户端部分会在对话头部操作区添加一个 **🗑 删除按钮**。点击确认后，会话被删除并刷新侧边栏。会话运行时按钮为禁用状态；有 agent 附着的会话会被服务器拒绝——当前对话永远无法被删除。

### API

插件在 Web 服务器上注册一个路由：

```http
POST /api-ext/session.delete
Content-Type: application/json

{ "sessionId": "session-1bb8d361-ea6b-4b92-bab2-c858c92e8822" }
```

同源调用可直接在 Harness 页面的浏览器控制台执行：

```js
await fetch("/api-ext/session.delete", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sessionId: "session-1bb8d361-ea6b-4b92-bab2-c858c92e8822" }),
}).then(r => r.json());
```

响应格式（与宿主 RPC 风格一致）：

```json
{ "ok": true, "value": { "detached": true, "workspaces": 1, "files": 1 } }
{ "ok": false, "error": { "code": "refused", "message": "..." } }
```

- `detached` — 会话已从内存 live store 移除（这就是它立刻从侧边栏消失、无需重启的原因）。
- `workspaces` — 从多少个工作区记录中摘除了该会话。
- `files` — 删除了多少个磁盘上的会话目录。

## 安全性

- 有 agent 附着（运行中或空闲）的会话会被**拒绝**——当前对话永远无法通过此端点删除。
- 删除不可逆：文件、工作区成员关系、live 条目都会被移除。session-projection 缓存可能保留一条无害的过期记录，直到下次重启。

## 工作原理

`session.list` 由 live `SessionStore` 加磁盘扫描共同提供。冷会话在列出时会被*准备进 live store*，因此文件删除后它们会以"幽灵"形式残留到服务器重启。本插件移除 live 条目（走 store 自身的 detach 通道）、从工作区记录摘除会话，并删除磁盘上的会话目录——让该行立即、永久消失。

## 开发

```sh
pnpm install        # peer: @deepseek-ai/cordis
node --test test/   # 单元测试
```

## 许可证

MIT
