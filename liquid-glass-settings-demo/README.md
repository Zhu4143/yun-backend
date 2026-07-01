# Liquid Glass Settings Demo

从主项目中独立整理出的“记忆设置”液态玻璃卡片示例。

## 运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 结构

- `src/App.jsx`：设置卡片结构和交互。
- `src/styles.css`：清透玻璃、厚边、色散、主题色反射。
- `src/OpticalFieldController.js`：统一的五参数光学场。

## Optical Field

```js
{
  intensity,
  distortion,
  flow,
  blur,
  chromatic,
}
```

示例使用鼠标位置模拟光学场输入。接入音乐时，只需要让音频分析器修改 Controller 的目标值，卡片无需直接读取 FFT。
