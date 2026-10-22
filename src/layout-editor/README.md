# 可迁移的 React 布局编辑器

入口是 `LayoutEditor`。拖动、八方向缩放、吸附、多选排列、历史记录和 JSON 校验集中在本目录，Yun 的音乐、语音、粒子和玻璃逻辑不在其中。

## 接到其他 React 项目

复制本目录中的 JSX、CSS 和非测试 JS 文件（包含 `ElementEditor.jsx` 和 `elementLayout.js`）。依赖现有的 React / React DOM，不需要新增拖拽库。注册目标卡片：

```jsx
import { useState } from 'react'
import LayoutEditor from './layout-editor/LayoutEditor'

// 在模块级声明，或者用 useMemo 保持引用稳定。
const items = [
  {
    id: 'notes', label: '笔记卡片', selector: '.notes-card',
    minWidth: 280, minHeight: 200,
    anchorX: 'right', anchorY: 'bottom',
    elementLabels: { '.notes-title': '笔记标题' },
    repeatSelectors: ['.note-row'],
  },
]

function Page() {
  const [editing, setEditing] = useState(false)
  return <main className={editing ? 'page layout-preview' : 'page'}>
    <section className="notes-card">原有内容</section>
    <LayoutEditor items={items} storageKey="my-project-layout-v1"
      onEditingChange={setEditing}/>
  </main>
}
```

宿主需要提供以下适配：

1. 卡片必须已挂载。`selector` 唯一匹配目标外壳，不能匹配嵌套按钮。隐藏的卡片在 `layout-preview` 下显示，才能测量默认尺寸。Yun 的适配例子是 `src/components/YunLayoutEditor.jsx` / `.css`。
2. 模块在外壳写入 `data-ui-layout` 和 `--ui-layout-x/y/width/height`；通用 CSS 将其设为视口中的固定矩形。如果宿主有优先级更高的 `!important` 样式，需要在宿主适配 CSS 覆盖。卡片的祖先不能改变固定定位的坐标系，例如对整个页面使用 `transform`。
3. 卡片内容用 Flex/Grid 或容器查询响应实际尺寸。缩放外壳不会自动缩放字号；进入“内部元素”可单独调整文字、按钮和容器。请按卡片自己的最小可用尺寸注册限制。
4. `onEditingChange` 只在进入、退出编辑时调用。拖动每帧只更新编辑器自己的状态和卡片 CSS 变量，不把鼠标位置传到页面状态。
5. 渲染器可以继续读取外壳的 `getBoundingClientRect()`。如果它会扫描按钮或卡片，排除 `[data-layout-editor-ui]` 工具层。编辑工具通过 Portal 放在 `document.body`。

框架无关的几何函数在 `layoutEngine.js`；Vue 等项目可以复用这些函数，但需要自己的编辑工具界面和 DOM 适配。

## 使用

- 左上角“布局”进入编辑，拖动卡片移动，八个控制点缩放。
- Shift 点击卡片或属性栏复选框多选，可整体移动、按指定间距横向/纵向排列。排列是一次操作，不是持续的父子自动布局约束。
- 边缘 / 中心吸附阈值 6 CSS 像素；按住 Alt 暂停拖动吸附。
- 属性栏输入 X、Y、宽、高。尺寸和位置都限制在可视区域内。
- “内部元素”显示所选卡片的图层，也能直接点击画面中的文字或按钮。拖动选中的控制框改变相对排版位置，八个控制点改变尺寸；偏移用 CSS `translate`，不会替换宿主已有的 `transform`。
- 文字和按钮支持字号、字重、行高、字距、文字对齐。容器支持启用 Flex 自动排版、方向、间距、内边距、两轴对齐、换行；子元素支持 `order` 排列顺序。容器排版持续响应其子元素尺寸。
- `elementLabels` 给内部选择器起易读名称。`repeatSelectors` 指定重复行模板；只登记首行的内部结构，属性规则应用到同类行。虚拟行位置、行高和播放数据由宿主负责，不复制或冻结歌曲名称。
- 选中轮廓后，方向键移动 1 像素，Shift + 方向键移动 10 像素。Ctrl/Cmd + Z 撤销，Ctrl/Cmd + Shift + Z 或 Ctrl/Cmd + Y 重做。
- 一次鼠标拖动只提交一个历史步骤；指针取消会恢复拖动前的位置。历史最多保存 60 步，退出后不保留历史。
- “保存并退出”写入当前浏览器、当前域名的 localStorage；“取消”或 Esc 恢复已保存布局。
- “恢复默认”预览宿主默认布局，保存后清除当前断点覆盖值，让宿主原来的 CSS 继续控制布局。
- 导出显示可复制 JSON，也提供下载文件。导入可粘贴 JSON 或选择文件，先预览，再明确保存。格式、版本或数值错误会显示原因。

## 数据和断点

```json
{
  "version": 2,
  "profiles": {
    "desktop": {
      "notes": {
        "x": -24, "y": -24, "width": 320, "height": 260,
        "anchorX": "right", "anchorY": "bottom"
      }
    },
    "compact": {}
  },
  "elements": { "desktop": {}, "compact": {} }
}
```

宽度小于 900 CSS 像素使用 `compact`，其余使用 `desktop`。两个配置独立保存。X/Y 在文件中是相对注册锚点的偏移；界面属性栏显示实际视口坐标。窗口变化时保持锚点偏移，并将卡片限制到屏幕内。编辑中改变窗口尺寸会适配当前草稿、开始新的撤销历史。

兼容读取版本1的几何文件，保存为版本2。`elements` 的键为 `卡片ID::结构路径`，例如 `notes::.notes-content > .notes-title`。路径仅允许标签 / 单个类名、`nth-of-type` 和直接子级关系；限制到宿主注册卡片内部，不能导入任意选择器。元素属性只接受规定范围的数字和排版枚举，不接受任意 CSS、文本或事件。其他项目需要映射卡片 ID 和内部结构路径；DOM 结构完全不同不能直接通用同一份元素 JSON。取消、撤销、导入、保存同时处理几何与内部属性。

## 验证

`node --test --test-isolation=none src/layout-editor/layoutEngine.test.js src/layout-editor/elementLayout.test.js` 验证锚点、边界、吸附、八方向缩放、历史、JSON、版本迁移、元素属性和导入限制。实际宿主还需要验证可见卡片、内容重排、保存刷新和原有开关动画。

当前版本支持已有容器的持续 Flex 排版和内部属性编辑；不支持新建 / 重设 DOM 父子关系、拖拽重组图层、画布缩放或富文本内容编辑。未注册卡片仍需添加宿主注册项和内容排版适配。

## GitHub 参考

- [Moveable](https://github.com/daybrush/moveable)：参考其选中目标控制框、拖动 / 缩放交互。当前实现未引入该依赖，也未复制其源码。
- [Craft.js](https://github.com/prevwong/craft.js) 与 [User Components 文档](https://craft.js.org/docs/concepts/user-components)：参考组件节点与属性面板的组织方式。当前保持原有业务 DOM，用宿主适配器、结构路径和受限样式实现；没有替换整个页面为 Craft 节点树。
