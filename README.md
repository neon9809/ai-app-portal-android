# AI应用门户 · AI App Portal for Android

用一句话描述需求，在手机上生成一个打开就能用的小工具。数据留在本机，能力按应用单独授权。

一个 Android App 壳 + H5 的混合应用：内置生成器把自然语言需求变成一个单文件网页工具，运行在独立沙箱里，可以像普通 App 一样从货架打开、继续修改、导出和备份。

> 本项目基于「AI App Portal」（`github.com/neon9809/ai-app-portal`）重写与移植，按 GPL-3.0 开源，详见文末「来源与许可」。

## 功能

- **造工具**：一句需求（可带图片 / 文本附件）→ 生成器自行判断数据结构与所需能力 → 生成、静态检查、离屏自检、最多 3 轮修复 → 安装到货架。
- **过程可见**：先出开发计划再逐步执行，每步的思考实时展示；关键疑问会暂停向你确认（答案记进需求）；推理模型的思考内容全程可见。
- **内置 MCP 工具**：生成过程中模型可调用 `get_time` / `get_weather` 拿真实数据再写代码（Chat Completions 与 Responses 双协议的 function calling）。
- **外部 MCP 服务器**：在「设置 → MCP」手动添加 Streamable HTTP 协议的 MCP 服务器（可带鉴权请求头），其工具与内置工具一起提供给模型；内置工具可逐个启停。
- **继续开发**：历史生成过程与后续修改合并成一条对话流，每次修改都有步骤与过程记录；可一键回溯到任意版本，也可删除某一版（源码随之回退，其后依赖的记录一并移除）。
- **本地沙箱**：每个工具运行在独立 iframe 里，只能通过 `window.portal` 使用本机存储、AI、白名单网络、剪贴板、文件、蓝牙、麦克风、相机、定位、MCP 工具（应用声明 `capabilities.mcp` 后经 `portal.mcp.call` 调用，逐应用授权）。
- **端侧原子能力**：经平台连接器转发，工具还能打开 / 查询其它应用、管理本机文件、批量上传、震动、语音播报、修改系统设置、打开快记录音、相机模式、查询天气。首次调用逐组授权。
- **触发器与提醒**：工具可注册时间（一次性 / 每天 / 间隔）或位置（进入 / 离开范围）触发器，触发时在门户顶部弹提醒（可选震动）并回调工具。没有系统级后台唤醒，门户打开时检查。
- **本机数据**：应用、数据、授权、触发器、用量、日志、审计全部存在本机 IndexedDB；支持 AES-GCM 加密备份与本地快照。
- **外观与语言**：浅色 / 深色跟随系统（可固定）；界面中英文跟随系统（可固定），生成的应用界面语言随之切换。
- **导入导出**：`.neon-aap` 应用包（ZIP：manifest + 单文件应用 + 说明），导入前做静态安全检查。

完整产品说明见 [`PRODUCT.md`](./PRODUCT.md)。

## 技术栈

React 19 · TypeScript · Vite 6 · Tailwind CSS 3 · lucide-react · react-router 7 · IndexedDB · fflate

## 快速开始

```bash
npm install
npm run dev        # 开发预览（默认 5173 端口）
```

浏览器预览没有 App 壳：原生能力走 mock 或显示不可用，端侧原子能力必须装到手机上验证。

```bash
npm run typecheck  # 类型检查
npm run test:e2e   # 端到端冒烟（逻辑链路 + 预览模块编译）
npm run build      # 构建 dist/client（默认配置，不依赖平台内部包）
```

`npm run build` 会调用 `finalize-build` 生成调试签名，需要本机有 JDK（`keytool`）；
签名口令在缺失时自动生成到 `capsule/signing/capsule.properties`，开箱即可构建。
需要平台预览能力（源码定位 / 元素点选 / 错误采集）时用
`npm run dev:platform` / `npm run build:platform`，它们依赖可选包 `stepai-vite-config`。

构建产物：

```
dist/client/
  manifest.json   壳侧应用清单
  icon/           桌面图标
  signing/        签名（本地生成，不入库）
  web/            H5 页面（index.html + assets + LICENSE + NOTICE）
```

`capsule/` 是壳侧交付信息的源码：`manifest.json`、图标、签名占位。签名证书与口令配置不随仓库分发，需要自行生成或使用调试证书：

```bash
npm run signing:debug
```

## 能力与限制

- 工具是单文件 HTML / JS；不支持 Python 与 pip。
- 能力逐应用授权，可在应用详情页撤回。
- 端侧原子能力走壳提供的 `window.mcp` 设备桥；普通浏览器预览没有原生桥，会显示不可用 / 重试。
- 触发器只在门户前台检查；关闭门户后不执行，错过的时间提醒在下次打开时补发（超过 30 分钟不再补）。
- 生成过程在页面内运行，切后台可能被系统暂停；中断的任务会以未完成草稿留在货架，可重新生成。

完整清单见 [`PRODUCT.md`](./PRODUCT.md) 的「能力与权限」「已知限制」。

## 目录

```
src/app/             App UI 页面、布局与组件
src/shared/portal/   数据层、生成器、沙箱、MCP 工具与服务器、设备能力、触发器、包格式、备份
src/shared/bridge/   壳原生能力桥接（native / mock）
src/shared/ui/       通用 UI 组件
src/shared/i18n/      中英文文案字典与语言切换
src/shared/theme.ts   浅色 / 深色主题
capsule/             壳侧 manifest、图标与签名占位
scripts/             构建、发布与 e2e 脚本
public/              静态资源（含 LICENSE / NOTICE）
```

## 运行环境

这个工程面向 AI Builder 平台的 Android 壳运行：

- 壳在页面加载时注入 `capsule` SDK 与 `/sdk/capsule.js`（构建期插件写入产物 HTML），提供拍照、录音、定位、蓝牙等原生能力；
- 端侧原子能力由壳的 `window.mcp` 提供，页面通过宿主转发调用；
- 默认构建（`vite.config.ts`）不依赖平台包；只有 `dev:platform` / `build:platform` 会使用可选的
  `stepai-vite-config`，用于源码定位、元素点选与预览错误采集。

## 贡献

提交前请跑：

```bash
npm run typecheck
npm run test:e2e
npm run build
```

改动说明、能力声明与测试结果请写在提交信息里。详见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 来源与许可

本项目基于「AI App Portal」重写与移植：

- 原项目：`github.com/neon9809/ai-app-portal`
- 原项目许可证：GNU General Public License v3.0（GPL-3.0）
- 本工程许可证：GPL-3.0，全文见 [`LICENSE`](./LICENSE)
- 来源、版权与第三方组件许可见 [`NOTICE`](./NOTICE)

原项目版权归其作者所有。本应用保留原项目的版权与许可声明，源码随应用提供，修改与再分发遵循同一许可证。
