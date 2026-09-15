# 数据查看大师（uTools 插件）

查看 JSON / JSONL / CSV / Excel 的本地数据文件，支持分页、列筛选、字段提取、钻取与原始记录弹窗。

## 功能

| 类型 | 扩展名 | 说明 |
|------|--------|------|
| JSON | `.json` | 整文件解析（≤400MB），对象/数组钻取 |
| JSONL | `.jsonl` `.ndjson` | 行偏移索引，大文件 O(1) 分页 |
| CSV/TSV | `.csv` `.tsv` | 表头 + 行索引分页 |
| Excel | `.xlsx` `.xls` | SheetJS 解析，多 Sheet、合并单元格 |

### 交互

- **打开文件**：插件内按钮，或在 uTools 中选中文件后触发「查看数据文件」
- **表格**：分页（20/50/100）、列筛选（回车提交）、全局搜索、隐藏列、提取嵌套字段为新列
- **钻取**：面包屑 / 路径跳转（如 `results[0].id`）
- **原始内容**：行号或可展开单元格 → 折叠 JSON 树弹窗

## 开发

```bash
npm install
cd public/preload && npm install && cd ../..   # Excel 依赖 xlsx
npm run dev          # http://localhost:5173
```

1. 打开 uTools → 开发者工具
2. 选择 `dist/plugin.json`（先 `npm run build`），或配置好 Vite 后选 `public/plugin.json`
3. 指令搜索「数据查看」

## 打包

```bash
npm run build        # 产物在 dist/
```

用 uTools 开发者工具加载 `dist/` 目录，或按官方流程制作离线安装包。

## 结构

```
plugin.json              # 根配置（开发时 uTools 加载这个）
public/
  plugin.json            # 打包进 dist 的配置
  preload/
    services.js          # window.services：view / record / pickDataFile
    libs/
      paths.js nodes.js
      backends/{json,jsonl,csv,excel}.js
src/
  App.vue
  Viewer/
    index.vue            # 主界面
    DataModal.vue JsonTree.vue
```

## API（preload）

```js
window.services.view(file, segPath, limit, offset, where, extraCols)
window.services.record(file, segPath)
window.services.getFileInfo(file)
window.services.pickDataFile()
```

`where` 示例：`{ "*": "关键字", name: "foo" }`
`extraCols` 示例：`["user.id", "meta.tag"]`（点路径提取列）

## 与原 Python 版差异

- 仅单文件查看，不管理数据目录树
- 不做 SQLite
- JSON 超过 400MB 不再流式解析，提示改用 JSONL
- Excel 富样式能力受 SheetJS 社区版限制（合并/超链接/批注尽力支持）
