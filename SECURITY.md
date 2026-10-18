# 安全说明

## 报告问题

请通过 GitHub 仓库的 **Security → Report a vulnerability**（Security Advisories）私下报告，
不要在公开 issue 中附上可利用细节、真实密钥或用户数据。

报告时请尽量说明：

- 受影响的版本 / 提交；
- 复现步骤与影响范围；
- 是否涉及沙箱逃逸、能力越权、导入包、触发器或备份。

## 安全边界

- 生成的应用运行在 `sandbox="allow-scripts allow-forms"` 的 iframe 中，拿不到宿主 DOM、
  localStorage、IndexedDB；这是**页面级隔离，不是原生进程沙箱**。
- 沙箱注入 CSP（`default-src 'none'`、`connect-src 'none'`），并覆写
  `fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon`；联网只能走
  `portal.network.fetch` 并校验主机白名单。
- 能力按应用逐项授权；端侧原子能力经宿主校验能力名后转发，原始错误不透传给应用。
- `.neon-aap` 导入前会做静态检查，发现外链、直连网络、禁用 API 会阻断。
- 模型 Key 只保存在本机，不写入应用包、日志或仓库。

## 不在范围内

- 已获得用户授权后，应用按声明调用能力造成的数据变化；
- 用户自行导入的第三方 `.neon-aap` 包的内容；
- 设备系统本身的安全问题。
