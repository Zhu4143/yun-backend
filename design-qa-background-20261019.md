# 沉浸背景发灰修正 · 2026-10-19

## 原因与隔离

原先 `readCoverBackgroundColors` 将封面按亮度分组后平均。白纸、黑字和不同色相混在一起，会得到低饱和度的灰色；沉浸阅读的亮度压缩又使明亮的灰色变成大片中灰。Chrome 中当前歌曲的黑白封面直接复现了灰色矿脉。

保持矿脉 shader、亮度限制、动画、歌曲和当前播放时间不变，仅替换取色后，同一首歌曲的背景从灰雾变成深蓝矿脉。灰色主要来自色板，而非按钮的玻璃层。这轮修改收敛在沉浸取色，未更改玻璃、流动算法、全局 VFX 设置或普通页面。

## 修改

- 新增 `src/app/immersivePalette.js`：一次 32×32 采样，按色相聚类并按色度加权，避免白底冲淡主色、互补色混成灰泥。忽略透明像素和极小的彩色噪点。
- 彩色封面保留主色和有足够占比的第二色相；黑白封面使用固定深蓝矿脉。四级色板保留深浅层次，强调色亮度高于主色。
- `immersiveRecordScene.js` 在已解码的封面上读取新色板，没有增加网络请求、常驻循环或依赖。继续使用原有 2.4 秒换歌色板过渡及中断续接。
- 新增 5 项取色回归测试并加入 `test:app`。

## 验证

- `npm.cmd run test:app`：44 项通过，退出 0。
- `node --test src/components/liquidMetalField.test.js src/components/liquidMetalSettings.test.js src/components/liquidMetalTransition.test.js`：10 项通过，退出 0。
- 全量 Lint、最终变更定向 Lint、最终生产构建均退出 0。沉浸模块约 42.98 kB / gzip 14.85 kB。
- Chrome 实际页面检查：同一首纯音乐、暂停状态、02:01 进度，深蓝背景下文字可读，两个按钮继续使用 `original / liquid-ore`、染色为 0。手机尺寸检查实际 CSS 视口为 354×767（浏览器缩放后），scrollWidth=354，无横向溢出；已恢复尺寸覆盖。
- 彩色小图案、互补色和黄色主色/蓝色强调色由像素回归用例验证；未用真实歌曲切换来冒充播放验证。实体手机与跨浏览器未测。
- 本地 Vite 5175 和 API 3030 此前已停止，Chrome 留有缓存旧页面；恢复服务并刷新后才做最终验证。没有修改账号、收藏或真实歌曲播放。

## 截图

![修改前](docs/design/jelly-glass-20261019/background-chrome-before.jpg)

![修改后](docs/design/jelly-glass-20261019/background-chrome-after.jpg)

![手机尺寸](docs/design/jelly-glass-20261019/background-mobile.jpg)
