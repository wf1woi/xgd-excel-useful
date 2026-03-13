# xgd-excel-useful

## 项目简介
本项目用于支撑银行合作场景下的通用 Excel 数据解析、规则加工、预览导出，以及后续 AI 客服商户额度查询能力建设。

当前需求来源于 `docs/开发需求.txt`，并配套提供了样例 Excel 文件，用于后续开发、联调与验收。

## 当前仓库状态
当前仓库已经完成基础项目初始化，现阶段包含：
- `backend/`：已初始化 `uv` Python 项目，包含最小可运行后端入口与基础目录结构
- `frontend/`：已初始化 React + TypeScript + Vite 项目，包含项目首页骨架
- `docs/开发需求.txt`：需求说明
- `docs/模板规则.xlsx`：模板规则样例
- `docs/需要上传的明细数据1.xlsx`：明细样例 1
- `docs/需要上传的明细数据2.xlsx`：明细样例 2
- `docs/最终生成数据示例.xlsx`：目标输出样例
- `docs/TODO.md`：整理后的开发架构与实施步骤

## 目标能力
### 一期目标
- 通用 Excel 明细解析配置
- 模板规则配置管理
- Excel 明细上传、解析、入库
- 规则处理预览
- Excel 导出
- 任务中心与日志追踪

### 二期目标
- AI 客服商户额度查询
- 定时报表生成
- 对账自动化

## 技术约束
- 前端使用 React，代码放在 `frontend/`
- 后端使用 Python，代码放在 `backend/`
- 使用 `uv` 管理依赖
- 新增依赖使用 `uv add <package>`
- 服务启动命令使用 `uv run main.py`
- 数据库使用 SQLite，存放在 `backend/db/`
- 日志按 `yyyyMMdd.log` 保存在 `backend/log/`

## 推荐目录规划
```text
backend/
frontend/
docs/
README.md
```

详细模块设计、数据模型、接口规划和开发步骤见 [docs/TODO.md](D:/XGD_SERVICE_SPACES/demo/xgd-excel-useful/docs/TODO.md)。

## 当前已完成
### 后端
- 已在 [backend/main.py](D:/XGD_SERVICE_SPACES/demo/xgd-excel-useful/backend/main.py) 提供 `uv run main.py` 启动入口
- 已建立 [backend/app/server.py](D:/XGD_SERVICE_SPACES/demo/xgd-excel-useful/backend/app/server.py) FastAPI 应用
- 已提供健康检查接口 `GET /api/health`
- 已为前端开发环境接入 CORS 放行配置
- 已接入 SQLite 数据库连接与启动时自动建表
- 已实现解析配置表 `parser_config` 与解析字段元数据表 `parser_config_column`
- 已实现统一 API 响应结构
- 已实现解析配置 CRUD 接口
  - `GET /api/parser-configs`
  - `POST /api/parser-configs`
  - `GET /api/parser-configs/{id}`
  - `PUT /api/parser-configs/{id}`
  - `DELETE /api/parser-configs/{id}`
- 已实现解析配置样本 Excel 预览接口
  - `POST /api/parser-configs/sample-preview`
  - 支持上传 Excel 并返回工作表列表、当前 sheet 名和二维表格预览数据
- 已实现模板规则集表 `template_rule_set`
- 已实现模板规则集 CRUD 接口
  - `GET /api/template-rules`
  - `POST /api/template-rules`
  - `GET /api/template-rules/{id}`
  - `PUT /api/template-rules/{id}`
  - `DELETE /api/template-rules/{id}`
- 已将模板规则结构升级为动态规则项 + 动态导出配置
  - 规则项元数据保存到 `rule_item_json`
  - 导出配置保存到 `rule_config_json.outputs`
  - 单条规则可同时维护多个导出结果，如 `明细表`、`汇总表`
- 已新增规则模板 Excel 导入接口
  - `POST /api/template-rules/import-preview`
  - `POST /api/template-rules/import-commit`
  - 支持读取 `docs/模板规则.xlsx`
  - 支持按 sheet 预览并按 sheet 批量创建规则
- 已实现导出预览接口
  - `POST /api/exports/preview`
  - 支持按“解析配置 + 模板规则 + 输出配置”生成真实预览数据
  - 支持按 `output_key` 选择同一规则下的不同导出 sheet
  - 支持 `export_month` 运行时参数，用于按月筛选规则
  - 已支持动态明细输出和动态汇总聚合输出
- 已实现明细导入批次接口
  - `POST /api/import-batches`
  - `GET /api/import-batches`
  - `DELETE /api/import-batches/{batch_code}`
  - 支持按解析配置把 Excel 明细导入到对应动态明细表
  - 支持多个 Excel 使用同一 `batch_code` 归档到同一批次
  - 支持按批次删除已导入的全部数据
- 已实现后台导入任务接口
  - `POST /api/import-tasks`
  - `GET /api/import-tasks`
  - `GET /api/import-tasks/{task_id}`
  - 前端可提交后台导入任务并轮询进度，不阻塞页面继续操作
  - 导入失败会写入日志，并通过任务状态和错误消息返回前端
- 已建立 `app/api`、`app/core`、`app/models`、`app/repositories`、`app/schemas`、`app/services`、`app/engines`
- 已建立 `backend/db/`、`backend/log/`、`backend/storage/uploads/`、`backend/storage/exports/`
- 已接入按天日志文件初始化逻辑

### 前端
- 已初始化 React + TypeScript + Vite 工程
- 已将 Vite 构建产物调整为相对资源路径，便于本地离线打开 `dist/index.html` 做演示和联调
- 已实现解析配置管理页基础工作台
- 已重构为步骤式、引导式工作台布局，提升用户友好度和配置清晰度
- 已重构为“列表页 + 弹窗编辑”布局
  - 解析配置列表页单独展示
  - 模板规则列表页单独展示
  - 配置详情、新建配置、样本校准改为弹窗
  - 规则详情、新建规则改为弹窗
  - 避免列表、详情、表单、预览表格全部挤在同一屏
- 已继续精简页面信息密度
  - 删除大段引导文案和冗余字段说明
  - 列表页只保留标题、操作按钮和卡片信息
  - 弹窗表单只保留必要字段，整体更干净
- 已将前端主页面重构为后台管理系统风格
  - 配置列表改为表格行展示，不再使用卡片
  - 模板规则列表改为表格行展示
  - 顶部内部设计文案已全部移除，不再对用户暴露
  - 清理了一批无用前端代码和旧布局样式
- 已为前端删除操作补充确认弹窗
  - 配置删除、模板规则删除、导入批次删除都会二次确认
- 已增加页面级使用说明、配置建议、步骤卡片和状态统计
- 已接入解析配置列表加载与详情展示
- 已接入新建解析配置表单
- 已接入样本 Excel 上传预览
- 已为样本校准增加预览自动推荐
  - 上传样本后自动推荐标题行、数据起始行、结束列
  - 支持一键套用推荐值，再按需手动微调
- 已修正样本预览列数截断问题
  - 预览默认范围调整为前 20 行、前 30 列
  - 后端返回原表总行列数与是否截断标记
  - 前端显示当前预览范围与原表范围，避免误判数据缺失
- 已实现预览表格辅助选择交互
  - 点击行号可设置标题行
  - 点击行号可设置数据起始行
  - 点击顶部列头可设置结束列
  - 选择结果会自动回填表单
- 已为样本校准补充头部固定字段识别
  - 支持识别标题行上方的固定字段区域
  - 支持单行左右两列规则：左侧字段名（兼容 `:` / `：`），右侧字段值
  - 支持双行单列规则：上方字段名，下方字段值
  - 识别结果可勾选、编辑、删除，也可手动新增固定字段
  - 手动新增既支持直接填写字段名和值，也支持填写 Excel 单元格引用，例如 `A8`、`B7`
  - 固定字段已支持“值跟随 Excel”开关，勾选后导入时会按每个文件自己的来源单元格取值
  - 样本校准弹窗已改为固定宽高工作区，字段表和预览表都在各自区域内部滚动
- 已将解析配置主流程改为自动识别字段结构
  - 根据标题行和数据起始行自动生成字段元数据
  - 用户侧直接查看 Excel 标题，不再手工维护英文字段映射
  - 配置详情和表单页都可直接查看识别出的字段结构
- 已新增模板规则管理工作台
  - 支持模板规则列表加载与详情展示
  - 支持新建、编辑、删除模板规则
  - 支持模板规则分页显示
  - 支持勾选后批量删除模板规则
  - 支持维护动态规则项
  - 支持维护多个动态导出配置
  - 支持维护每个导出配置的字段、过滤条件、分组字段和聚合字段
  - 支持导入规则模板 Excel，并按 sheet 批量创建规则
  - 规则模板导入已重构为“选行 + 选字段列”模式，不再使用旧的字段映射表单
  - 支持先选择“规则项字段行”，系统读取该行所有字段名，再勾选要作为规则项的字段列
  - 支持再选择“导出项字段行”，系统读取该行所有字段名，再勾选要作为导出字段的字段列
  - 已兼容规则模板中的银行名称字段同义表头，如 `银行名称（出资方名称）` 与 `银行名称（与出资方名称一致）`
  - 导入规则弹窗已补齐“规则项示例 + 导入预设配置”，结构与新建规则保持一致
  - 导出配置中的输出字段、过滤条件、分组字段和聚合字段，都会基于用户选定的规则项字段和导出项字段继续配置
- 已新增明细导入工作台
  - 支持选择解析配置并上传 Excel 明细
  - 支持一次选择多个 Excel 文件提交后台导入
  - 支持手工指定批次号，多个 Excel 可归到同一批次
  - 支持显示最近导入任务、任务进度条、任务状态和错误消息
  - 支持查看最近导入批次、文件数、导入行数和状态
  - 支持按批次删除全部已导入数据
  - 导入时会按解析配置的固定字段规则，为每条明细自动补充固定字段值
  - 固定字段若勾选“值跟随 Excel”，会在每份导入文件中重新按来源单元格解析，不会写死样本值
  - 导入成功后会自动回填到预览导出页
- 已新增预览导出工作台
  - 支持选择解析配置、导入批次和模板规则生成组合预览
  - 模板规则支持模糊搜索选择
  - 模板规则下拉支持分页追加加载
  - 支持选择模板规则中的具体输出配置
  - 支持填写导出月份参与运行时规则计算
  - 预览结果已切换为动态明细表中的真实数据
  - 模板规则已实际参与预览处理，可执行过滤、排序、分组聚合和多 sheet 输出
  - 预览结果已改为分页显示，默认每页 100 条，支持页码跳转
  - 预览结果区固定尺寸，超出后在内部滚动
  - 支持导出 CSV 和真实 Excel 文件
  - Excel 导出已支持同一规则下生成多个 sheet
- 已新增导入明细查看页
  - 支持按解析配置和导入批次查询真实明细数据
  - 支持分页查看，默认每页 100 条
  - 支持按字段关键字过滤
  - 支持表头冻结和首列固定，便于宽表查看
  - 已支持查看固定字段列
- 已优化预览导出页交互
  - 自动带出首条可用解析配置、导入批次和模板规则
  - 新建配置、导入批次或规则后会自动回填到预览生成器
  - 修正下拉框空值处理，避免误传无效 ID
- 已建立 `src/api`、`src/components`、`src/pages`、`src/types`、`src/utils`

## 当前联调结果
- 已通过真实浏览器完成前端联调
- 已验证新版页面在桌面端布局下具备更清晰的操作引导和信息层级
- 已验证配置列表可正常加载
- 已验证新建解析配置后，列表和详情会即时刷新
- 已验证上传 [docs/需要上传的明细数据2.xlsx](D:/XGD_SERVICE_SPACES/demo/xgd-excel-useful/docs/需要上传的明细数据2.xlsx) 后可正常展示二维预览表格
- 已完成导出预览接口联通验证，当前返回的已是动态明细表中的真实数据
- 已通过 TestClient 验证模板规则执行链路
  - 可按 sheet 预览并导入规则模板 Excel
  - 可按动态 `filters` 过滤行
  - 可按动态 `sort_by` 排序
  - 可按动态 `fields` 控制输出字段
  - 可生成 `明细表` 与 `汇总表`
  - 可执行 `group_by_fields + aggregations` 汇总计算
- 已通过 `POST /api/exports/excel` 验证真实 Excel 导出
  - 导出文件会落到 `backend/storage/exports/`
  - 前端可直接下载 `.xlsx` 文件
  - 单个导出文件内可包含多个业务 sheet
- 已通过 TestClient 验证动态明细导入链路
  - 可创建解析配置并保存字段结构
  - 可自动创建对应动态明细表
  - 可将样例 Excel 成功导入 100639 行和 55 行明细
  - 可使用同一批次号连续导入多个 Excel 文件
  - 可按批次读取真实预览结果并整批删除
  - 可创建后台导入任务并轮询到成功状态
  - 已验证固定字段可按样本来源单元格保存，并在实际导入时按文件重新解析后写入每一行明细
  - 已验证“值跟随 Excel”开启时，不同文件会按各自头部单元格值写入导入结果
- 已补充后端异常兼容与日志输出
  - 已兼容旧版固定字段 JSON 缺少 `follow_excel_value` 时的读取逻辑
  - 未捕获的后端异常会写入 `backend/log/YYYYMMDD.log`
  - 启动失败异常也会写入日志文件

## 启动方式
### 一键启动脚本
项目根目录已提供：

- Windows: [start_windows.bat](D:/XGD_SERVICE_SPACES/demo/xgd-excel-useful/start_windows.bat)
- Windows 核心脚本: [start_windows.ps1](D:/XGD_SERVICE_SPACES/demo/xgd-excel-useful/start_windows.ps1)
- macOS: [start_mac.command](D:/XGD_SERVICE_SPACES/demo/xgd-excel-useful/start_mac.command)

脚本行为：

- 启动前校验 `uv`、`node`、`npm`
- 若系统已安装 Python 但未安装 `uv`，启动脚本会先询问用户，再决定是否使用 `uv` 官方安装脚本自动安装
- 校验 `backend/.venv` 与 `frontend/node_modules` 是否存在
- 若缺少 `backend/.venv` 或 `frontend/node_modules`，启动脚本会先询问用户，再决定是否自动执行 `uv sync` / `npm install`
- Windows/macOS 会优先直接校验本地虚拟环境中的 Python 和前端本地 `vite` 可执行文件，减少 `uv` cache 权限问题导致的误失败
- 校验通过后同时启动前后端开发服务
- 启动时会明确提示“前端服务窗口”和“后端服务窗口”的用途，并提醒用户运行期间不要关闭终端
- 启动后会在前后端都就绪后自动打开浏览器，并访问前端地址 `http://localhost:5173`
- Windows 采用 `PowerShell` 作为实际执行器，避免 `cmd/bat` 中文乱码和编码不稳定问题
- macOS 启动时会复用当前终端作为后端服务窗口，只额外打开一个前端服务窗口，避免出现第三个检查窗口

如只想校验环境，不启动服务：

```bash
start_windows.bat --check-only
bash start_mac.command --check-only
```

### 后端
在 `backend/` 目录执行：

```bash
uv run main.py
```

默认健康检查地址：

```text
http://127.0.0.1:8000/api/health
```

解析配置接口示例地址：

```text
http://127.0.0.1:8000/api/parser-configs
```

样本预览接口示例地址：

```text
http://127.0.0.1:8000/api/parser-configs/sample-preview
```

导出预览接口示例地址：

```text
http://127.0.0.1:8000/api/exports/preview
```

Excel 导出接口示例地址：

```text
http://127.0.0.1:8000/api/exports/excel
```

规则模板导入预览接口示例地址：

```text
http://127.0.0.1:8000/api/template-rules/import-preview
```

规则模板导入提交接口示例地址：

```text
http://127.0.0.1:8000/api/template-rules/import-commit
```

明细导入接口示例地址：

```text
http://127.0.0.1:8000/api/import-batches
```

### 前端
在 `frontend/` 目录执行：

```bash
npm run dev
```

## 样例资产用途
- `docs/需要上传的明细数据1.xlsx`、`docs/需要上传的明细数据2.xlsx`：用于验证明细解析配置
- `docs/模板规则.xlsx`：用于验证模板规则导入设计
- `docs/最终生成数据示例.xlsx`：用于验证最终导出结构和字段结果
