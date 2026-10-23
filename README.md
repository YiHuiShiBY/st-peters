# 圣彼得大教堂 · 三维漫游（St. Peter's Basilica · 3D Explorer）

以 1748 年前后的空间关系为参考，对圣彼得大教堂及周边历史街区做的一次**艺术复原**（非精确测绘）：主体教堂、椭圆形广场与柱廊之外，还补入北侧宫殿与院落、南侧旧圆形祭衣室、广场入口的 Borgo 双街与中央街块、后方围墙花园，以及 5332 栋红瓦住宅构成的历史街区。全部场景在浏览器里实时渲染，可以漫游、昼夜切换、在七个电影视角之间跳转。

**在线演示**：[仪绘士 · 画境长廊](https://yihuishi.com) —— 作品 03「圣彼得大教堂」。

## 运行方式

纯静态、零构建、零外部依赖：Three.js 与 DRACO 解码器已内置在 `vendor/`，模型资产内置在 `assets/`，启动后不需要联网。

由于页面使用 ES Module，请通过任意静态服务器打开（直接双击 `index.html` 会受浏览器 file:// 限制）：

```bash
# 任选其一
python -m http.server 4173
npx serve .
```

然后访问 `http://127.0.0.1:4173/`。模型共约 62 MB，首次载入需要一些时间。

## 操作

| 操作 | 说明 |
|---|---|
| 拖动 / 滚轮 / 右键 | 旋转 / 缩放 / 平移 |
| `1` – `7` | 预设视角：航拍全景、正面立面、穹顶细节、俯视布局、从后殿望向广场、红瓦街巷与布棚集市、花园与树冠 |
| `N` / `B` | 夜景 / 白昼 |
| 空格 | 自动旋转 |
| `H` | 复位 |
| `Tab` | 隐藏 / 显示界面 |
| 场景左下 | 「显示周边环境」开关：只看教堂，或连同历史街区一起 |

## 场景构成

数据与校验见 `assets/manifest-historic.json`（含 SHA-256）：

- **教堂主体** `basilica-medieval.glb`：601 个网格、约 208 万三角面、46 种材质
- **历史街区** `context-historic.glb`：98 个网格、约 688 万三角面、5332 + 126 栋建筑、479 株按位重修的树
- 两份 glb 均由 Blender 工程导出，经 **DRACO** 几何压缩（页面端由内置解码器解压）

## 技术栈与目录

Three.js（本地内置副本，许可见 `vendor/LICENSE.three.txt`）+ glTF（`KHR_draco_mesh_compression`、`KHR_materials_sheen`、`KHR_materials_specular`、`KHR_texture_transform` 扩展）。无构建流程、无框架、无运行时外部请求。

```
index.html            入口：界面、视角按钮、加载页
app.js                场景装配、预设视角、昼夜切换、交互
daylight.js           白昼光照与天空
nightscape.js         夜景光照与灯火
surface-finish.js     建筑表面材质修整
controls-suite.js/.css 控件套件
assets/               glTF 模型与 manifest
vendor/               Three.js、DRACO 解码器（本地依赖）
第三方许可/            第三方组件许可说明
```

## 声明与许可

- 这是对历史空间关系的艺术复原，不宣称精确还原测绘，也没有制作室内空间。
- 第三方组件：[Three.js](https://github.com/mrdoob/three.js)（MIT，全文见 `vendor/LICENSE.three.txt`）、[DRACO](https://github.com/google/draco) 几何压缩（Apache License 2.0，说明见 `第三方许可/DRACO.md`）。
- 除上述第三方组件外，本仓库的代码与内容**保留所有权利**。
