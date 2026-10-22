# 原版果冻玻璃恢复 · 2026-10-19

分支：`feature/netease-capability-p2`。保留其他未提交改动，没有提交、发布或打包安装器。

## 确认的问题

用户的判断成立。轻量版曾把原版玻璃换成 `GlassSurface` 的静态 SVG 位移图；沉浸播放胶囊为了规避偶发横条，又使用了 `blur(8px)` 的普通材质。两者都没有接回旧版 `liquidOreSource` 的 hover 弹簧、曲面鼓起及动态折射。

基线在真实预览中读到：返回按钮 `data-glass-mode=optical`，播放栏 `material`，对应 SVG backdrop / 普通 blur。截图：`docs/design/jelly-glass-20261019/before.jpg`。保留相似边框或一部分公式不等于保留原版材质。

原版仍在 `src/components/liquidOreSource.js`，旧 CD 皮肤的适配器是 `src/skins/cd-case/CdLiquidOre.js`。

## 本轮实现

- 新增 `src/app/liquidGlassPass.js`，直接导入原版 `LIQUID_ORE_GLASS_FRAGMENT_SHADER`、`LIQUID_ORE_BLUR_FRAGMENT_SHADER` 及保存的玻璃参数。保留原曲面距离场、平方根高度、色散、边缘高光、指针光晕和 hover 折射，未修改原 shader 方程。
- 新增 `glassInteraction.js`，复用 `stepLiquidOreHover` 的弹簧；小步积分，快速移入移出保留位置和速度，稳定后停止动画。按压也能触发反馈；减少动态效果时关闭空间形变，只保留静态提示。
- `GlassSurface.jsx` 负责 DOM 布局与可读降级层，原版材质画好后才切换 `data-glass-mode=original`。旧 SVG 分色链和胶囊的普通模糊替代路径不再使用。只注册可见外层表面，嵌套控件不叠加透镜。
- 普通页面使用 `OriginalGlassBackdrop` / `originalGlassScene`，背景只借封面色彩，保持均匀亮度；仅交互、过渡、尺寸变化或换歌时绘制。没有恢复粒子、旧唱片盒或常驻流动背景。
- 沉浸模式将同一玻璃 pass 接到已有唱片 renderer 中，不额外创建沉浸玻璃的 WebGL 上下文。保留矿脉、实体唱片和换歌过渡；为中间场景缓冲开启 2× MSAA，避免盘面边缘因接入后处理而变锯齿。
- 原 shader 采样场景背景；用同一渲染结果的小块 2D canvas 放在各表面文字下面，并随曲面裁成透明圆角，解决工作区和弹窗背景遮住原材质的问题。文字和图标保持清晰、点击位置不变。这些局部画布不创建独立 WebGL renderer。
- 普通页面绘制预算约 80 万像素，交互期间最多 60 FPS；沉浸保留约 95 万像素、30 FPS。普通页面在沉浸期间冻结，退出淡入时提前恢复。两份视图资源可短暂并存，静止普通页面没有持续 RAF；这些是实现预算，不是实体设备的帧率或功耗测量。
- 修正淡入时透明度低造成永久漏登记的问题；修正观察器反复注册可能形成的空闲循环；每次挂载创建独立 canvas，兼容开发模式的 StrictMode 清理与重建。
- 恢复深色玻璃后，队列、评论、模式菜单使用对应浅色文字和可见滚动条，避免延用浅色面板的深色字。

主要变更还包括 `glassContext.js`、`LiquidGlassLayer.jsx`、`MusicApp.jsx`、`ImmersiveRecordScene.jsx`、`immersiveRecordScene.js`、`PlayerPanel.jsx`、`music.css` 和 `package.json`。

## 验证

- `npm.cmd run lint` 退出 0；最后的视图恢复修改定向 ESLint 退出 0。
- `npm.cmd run test:app`：39 项通过，其中新增 9 项覆盖弹簧回弹、打断连续性、减少动态效果、淡入登记、外层过滤、观察器重复注册、卸载释放、局部合成顺序以及透明按钮不继承面板深色染色。
- `node --test src/components/liquidOreSource.test.js src/components/liquidMetalField.test.js`：6 项通过。
- `npm.cmd run build` 与 `git diff --check` 退出 0。
- 生产构建主 JS 约 487.48 kB / gzip 148.46 kB。恢复原材质需要约 528.26 kB / gzip 134.86 kB 的 Three.js/玻璃共享模块；玻璃初始关闭时普通页面不需要加载它，关闭开关会释放画布和 GPU 资源。沉浸模块约 42.56 kB / gzip 14.59 kB，复用共享模块。没有新增依赖。
- 内置浏览器生产预览确认普通页面、设置、沉浸控制、队列、评论、播放模式都使用 `original / liquid-ore`，SVG 定义数量为 0。玻璃关闭后 canvas 数及 original 表面数均为 0，重新打开后恢复。
- 鼠标移入搜索框前后，输入框边界均为约 `(387.86,40.25,392.45,21.5)`，光学体变化不移动文字和点击区域。保存移入、移出和播放按钮状态截图；没有观察到之前截图中的图标横向残影，但旧横条的底层根因依然没有得到复现证明。
- 检查 1280×720、390×844、375×812、430×932、844×390，实际读取视口和边界，无横向溢出。390×844 的沉浸胶囊为 260×72，原版材质覆盖两个外层控件；歌词、队列及控制可用。
- 收起沉浸后，唱片画布数为 0、应用 inert 清除，普通页面 5 个表面恢复原版玻璃。
- 真实预览此前仍显示断开连接前缓存的旧组件。本轮恢复 `5175` 的 Vite 和 `3030` API 服务，HTTP 确认 200，并重新打开实际页面完成启动。最终实景另存 `live-preview.jpg`。

压力交互和播放/换歌使用本机隔离合成素材，不操作真实歌曲的播放和收藏。真实页面只读取和展开当前缓存歌曲。没有验证实体手机触摸、GPU 功耗、跨浏览器一致性；减少动态效果有逻辑测试，未切换用户的系统设置。

开发终端存在原有 lucide sourcemap 缺失提示；复用盘面 shader 时观察到一条 `f_room` 潜在未初始化的编译器警告。生产预览没有观察到 WebGL 渲染错误，这两类提示没有作为本轮材质故障的根因。

## 后续修正：透明按钮被染黑

原因是复用 CD 适配器时，沉浸视图统一使用了 `uBodyOpacity=.72` 的深色染色；DOM 背景实际透明，黑色来自 shader。隔离观察：保留 .72 时胶囊发黑，仅将其改为 0 并重新进入同一歌曲后，按钮透出背景颜色，曲面高光和折射仍在。

最终为 opt-in 染色分支增加逐表面的透明度，返回按钮和播放胶囊通过 `--glass-tint-opacity:0` 去掉底色；阅读面板保持原有对比度。光学方程和弹簧不变，旧适配器未启用新宏时仍使用原默认染色。无 WebGL / 关闭玻璃时的按钮降级层也移除了深色填充。

重新完成 Lint、39 项 app 测试、6 项原材质/背景测试和生产构建，均退出 0。内置浏览器检查同一首真实歌曲的展开、收起、队列，以及 390×844 尺寸；返回和播放胶囊均为 original 材质、染色为 0，手机无横向溢出。没有播放或更改真实歌曲。

对比截图：`tint-before.jpg`、`tint-after.jpg`；补充：`tint-queue.jpg`、`tint-mobile-queue.jpg`、`tint-mobile.jpg`。这些是本轮最新透明度效果，下面的早期截图保留作材质恢复过程记录。

![取消深色染色后的当前效果](docs/design/jelly-glass-20261019/tint-after.jpg)

## 早期材质恢复截图

![沉浸模式](docs/design/jelly-glass-20261019/immersive.jpg)

![普通页面](docs/design/jelly-glass-20261019/desktop.jpg)

![手机布局](docs/design/jelly-glass-20261019/mobile.jpg)

![队列可读性](docs/design/jelly-glass-20261019/mobile-queue.jpg)

其他证据同目录：`settings.jpg`、`search-hover.jpg`、`immersive-hover.jpg`、`immersive-release.jpg`、`mobile-modes.jpg`、`landscape.jpg`。
