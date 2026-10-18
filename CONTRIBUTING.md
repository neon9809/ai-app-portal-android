# 贡献指南

感谢你愿意改进「AI应用门户」。

## 环境

- Node.js >= 20.19
- 项目使用 npm；请提交 `package-lock.json` 的变更

```bash
npm install
npm run dev
```

## 提交前检查

三项都要通过：

```bash
npm run typecheck   # TypeScript 类型
npm run test:e2e    # 逻辑链路 + 预览模块编译冒烟
npm run build       # 壳侧产物构建
```

## 代码约定

- 颜色、圆角、间距只用 `src/shared/styles/tokens.css` 里的语义 token，不写死色值。
- 新的原生能力调用统一走 `src/shared/bridge`，不要直接访问 `window.capsule`。
- 生成应用只能通过 `window.portal` 访问能力；端侧原子能力只经 `window.portal.device.call`。
- 新增能力必须同时更新：能力声明类型、授权文案、生成器提示词、静态检查、`PRODUCT.md` 与 `NOTICE`（如涉及新的第三方组件）。
- 不要提交密钥、`.env.local`、签名证书（`capsule/signing/*.p12`、`capsule.properties`）或平台内部元数据。

## 提交信息

写清楚三件事：

1. 改了什么；
2. 为什么改；
3. 怎么验证的（命令与结果）。

## 许可证

提交代码即表示你同意以 GNU General Public License v3.0（GPL-3.0）授权你的贡献。
请只提交你有权提交的代码；引用第三方代码时，在 `NOTICE` 中补充来源与许可证。
