# xgd-excel-useful 开发 TODO

## 1. 项目目标
本项目定位为一个面向银行合作对账场景的通用 Excel 处理工具平台，目标是解决两类核心问题：

1. 商户活动额度查询
- 通过 AI 客服在群内接收商户号查询请求。
- 根据商户号查询内部管理平台中的活动补贴额度使用情况。
- 返回结构化、可追溯的答复结果。

2. 银行报表与对账单生成
- 从内部管理平台导出的多份明细 Excel 中读取数据。
- 按预设模板规则进行字段映射、聚合、透视、按月展示、格式化。
- 生成银行需要的标准报表与对账单。

本期建议先聚焦“通用 Excel 解析 + 模板规则配置 + 数据处理预览导出”主链路，AI 客服查询能力作为第二阶段扩展模块接入。

## 2. 产品范围

### 2.1 本期范围（MVP）
1. 明细解析配置管理
2. 模板规则配置管理
3. Excel 文件上传、解析、入库
4. 按规则处理数据并预览结果
5. 导出处理结果 Excel
6. 配置版本管理与启停控制
7. 解析任务、导出任务、日志追踪

### 2.2 二期范围
1. AI 客服群聊查询接口
2. 商户号额度查询服务
3. 固定时间报表自动生成
4. 固定时间自动发送银行文件
5. 对账差异检测与异常提示

## 3. 总体架构设计

### 3.1 技术选型
- 前端：React
- 后端：Python
- 依赖管理：uv
- 数据库：SQLite
- 日志：按天落盘到 `backend/log/yyyyMMdd.log`
- 数据库文件：`backend/db/*.sqlite3`

### 3.2 架构原则
- KISS：优先做单体应用，避免过早拆分微服务。
- YAGNI：本期不引入消息队列、分布式任务系统、多租户隔离等超前设计。
- DRY：Excel 读取、表头识别、字段结构识别、规则执行、导出能力统一抽象，避免为每个模板重复开发。
- SOLID：通过解析器、规则引擎、导出器分层，降低页面逻辑与 Excel 处理逻辑耦合。

### 3.3 分层架构
建议采用前后端分离 + 后端单体服务架构。

#### 前端层（React）
负责：
- 配置管理界面
- Excel 上传与框选交互
- 数据预览
- 任务状态查看
- 导出下载

#### API 层（Python Web）
负责：
- 提供配置、上传、解析、预览、导出接口
- 参数校验
- 返回统一响应结构

#### 应用服务层
负责：
- 解析配置管理
- 模板规则管理
- Excel 导入任务编排
- 数据处理任务编排
- 导出任务编排

#### 领域能力层
负责：
- Excel 解析器
- 表头定位器
- 数据清洗器
- 规则执行引擎
- 导出生成器
- 商户额度查询适配器（二期）

#### 基础设施层
负责：
- SQLite 持久化
- 文件存储
- 日志记录
- 配置读取

### 3.4 推荐后端目录结构
```text
backend/
  main.py
  pyproject.toml
  app/
    api/
    core/
    models/
    schemas/
    services/
    repositories/
    engines/
      excel/
      rules/
      export/
    utils/
  db/
  log/
  storage/
    uploads/
    exports/
```

### 3.5 推荐前端目录结构
```text
frontend/
  src/
    api/
    pages/
      parser-config/
      template-rule/
      excel-import/
      preview-export/
      task-center/
      merchant-query/
    components/
    hooks/
    store/
    utils/
    types/
```

## 4. 核心模块设计

### 4.1 模块一：明细解析配置
用于定义“一个 Excel 明细文件应该如何被读取”。

#### 核心能力
1. 上传任意 Excel 样本
2. 前端展示基础网格数据
3. 用户框选标题行、数据起始行、结束列
4. 系统根据标题行自动识别字段结构
5. 保存解析配置
6. 后续导入明细时可绑定该解析配置

#### 建议配置字段
- 配置名称
- 配置编码
- sheet 名称或索引
- 标题行号
- 数据开始行号
- 数据结束列
- 是否忽略空行
- 字段结构元数据（自动识别）
- 状态
- 版本号
- 备注

### 4.2 模块二：模板规则配置
用于定义“如何将明细数据加工成目标报表”。

#### 核心能力
1. 上传模板规则 Excel
2. 按 sheet 预览规则分类
3. 每个 sheet 作为一类规则批量入库
4. 每条规则单独编辑、删除、启停、版本管理
5. 每条规则支持维护多个动态导出配置
6. 支持明细输出与汇总输出

#### 规则类型建议
- 动态输出字段 `fields`
- 过滤条件 `filters`
- 排序规则 `sort_by`
- 分组字段 `group_by_fields`
- 聚合字段 `aggregations`
- 按月展开
- 透视行列
- 固定值填充
- 公式列生成
- 数值格式化

### 4.3 模块三：通用 Excel 数据读取
用于将业务明细 Excel 按解析配置入库。

#### 处理流程
1. 上传 Excel 文件
2. 选择解析配置
3. 后端解析 sheet
4. 清洗空值、异常值、日期、金额
5. 写入明细表
6. 生成导入任务记录

### 4.4 模块四：规则处理预览与导出
用于将明细数据按规则处理，并生成结果。

#### 核心能力
1. 选择数据批次
2. 选择模板规则
3. 生成预览数据
4. 展示预览表格
5. 导出 CSV / Excel
6. 记录导出历史

### 4.5 模块五：任务中心
建议新增。

#### 核心能力
- 查看上传任务
- 查看解析任务
- 查看导出任务
- 查看成功/失败状态
- 查看错误原因
- 支持重新执行

### 4.6 模块六：AI 客服商户查询（二期）
建议预留，不在 MVP 强实现。

#### 核心能力
- 根据群内消息提取商户号
- 查询额度与使用情况
- 生成标准化答复话术
- 记录问答日志

## 5. 页面设计

### 5.1 页面一：解析配置管理页
功能：
- 配置列表
- 新建配置
- 上传样本 Excel
- 网格预览
- 框选表头/数据范围
- 自动识别字段结构
- 配置保存与版本管理

### 5.2 页面二：模板规则管理页
功能：
- 规则列表
- 上传模板规则 Excel
- 规则明细查看
- 规则编辑
- 启停与版本切换

### 5.3 页面三：明细导入页
功能：
- 上传明细 Excel
- 选择解析配置
- 填写或复用批次号
- 支持多个 Excel 归入同一批次
- 查看最近导入批次
- 按批次删除已导入的全部数据
- 为预览导出提供批次选择

### 5.4 页面四：处理预览与导出页
功能：
- 选择解析配置
- 选择导入批次
- 选择模板规则
- 读取动态明细表生成真实预览
- 导出 Excel
- 下载结果文件

### 5.5 页面五：任务中心页
功能：
- 任务列表
- 状态筛选
- 错误详情
- 重试操作

### 5.6 页面六：系统设置页
建议新增。

功能：
- 文件存储目录配置
- 默认导出命名规则
- 日志级别
- AI 客服配置预留

## 6. 核心数据流设计

### 6.1 明细导入数据流
1. 用户上传一个或多个明细 Excel
2. 选择解析配置并指定批次号
3. 后端读取配置
4. Excel 解析器按配置提取数据
5. 数据标准化
6. 写入动态明细表
7. 以批次号归档导入记录

### 6.2 规则处理数据流
1. 用户选择明细批次与规则模板
2. 后端读取明细数据
3. 规则引擎逐条执行规则
4. 生成预览结果集
5. 结果写入导出快照或临时表
6. 用户导出 Excel 文件
7. 写入导出任务表

### 6.3 AI 查询数据流（二期）
1. 接收消息
2. 识别商户号
3. 查询额度数据
4. 生成回复
5. 返回群聊
6. 落库查询日志

## 7. 数据库设计

### 7.1 建议核心表

#### parser_config
解析配置表
- id
- config_code
- config_name
- sheet_name
- header_row_index
- data_start_row_index
- data_end_column
- ignore_empty_row
- status
- version
- remark
- created_at
- updated_at

#### parser_config_column
解析配置字段元数据表
- id
- parser_config_id
- column_index
- column_letter
- header_name
- field_name
- sample_value
- is_enabled
- created_at
- updated_at

#### import_batch
明细导入批次表
- id
- parser_config_id
- file_name
- sheet_name
- detail_table_name
- status
- imported_rows
- error_message
- created_at
- updated_at

#### detail_{config_code}
动态明细表
- id
- batch_id
- row_number
- 按标题自动生成的动态字段列

#### template_rule_set
模板规则集表
- id
- rule_code
- rule_name
- group_name
- source_sheet_name
- description
- rule_item_json
- rule_config_json
- status
- version
- created_at
- updated_at

#### import_batch
导入批次表
- id
- batch_no
- parser_config_id
- source_file_name
- source_file_path
- total_rows
- success_rows
- failed_rows
- status
- error_message
- created_at

#### detail_record
明细数据表
- id
- import_batch_id
- row_no
- raw_data_json
- normalized_data_json
- business_date
- merchant_no
- amount
- created_at

#### export_batch
导出批次表
- id
- export_no
- rule_set_id
- import_batch_id
- export_file_name
- export_file_path
- total_rows
- status
- error_message
- created_at

#### query_log（二期）
AI 查询日志表
- id
- merchant_no
- request_text
- response_text
- source_channel
- created_at

### 7.2 设计说明
- 明细数据建议同时保留 `raw_data_json` 与 `normalized_data_json`，方便回溯与调试。
- SQLite 适合本地工具型项目，后续如数据量持续增长可平滑迁移到 PostgreSQL。
- 规则表拆分为规则集与规则项，便于版本管理和扩展。

## 8. 后端接口规划

### 8.1 解析配置接口
- `GET /api/parser-configs`
- `POST /api/parser-configs`
- `GET /api/parser-configs/{id}`
- `PUT /api/parser-configs/{id}`
- `POST /api/parser-configs/{id}/sample-preview`

### 8.2 模板规则接口
- `GET /api/template-rules`
- `POST /api/template-rules/import-preview`
- `POST /api/template-rules/import-commit`
- `POST /api/template-rules`
- `GET /api/template-rules/{id}`
- `PUT /api/template-rules/{id}`
- `DELETE /api/template-rules/{id}`

### 8.3 明细导入接口
- `POST /api/import-batches/upload`
- `GET /api/import-batches`
- `GET /api/import-batches/{id}`
- `GET /api/import-batches/{id}/records`

### 8.4 预览导出接口
- `POST /api/exports/preview`
- `POST /api/exports`
- `GET /api/exports`
- `GET /api/exports/{id}/download`

### 8.5 任务中心接口
- `GET /api/tasks`
- `GET /api/tasks/{id}`
- `POST /api/tasks/{id}/retry`

### 8.6 AI 查询接口（二期）
- `POST /api/merchant-quota/query`
- `POST /api/chat/callback`

## 9. 核心技术实现建议

### 9.1 Excel 处理能力
建议统一封装 3 个核心对象：
- `ExcelReader`：负责读取 sheet、单元格、行列范围
- `ParserEngine`：负责按解析配置提取明细数据
- `RuleEngine`：负责按规则集生成目标结果

### 9.2 规则引擎实现方式
本期建议采用“配置驱动 + Python 映射执行器”模式：
- 不引入复杂 DSL 解释器
- 每种规则类型对应一个清晰的执行器
- 规则顺序按 `sort_order` 执行

这样实现简单，可维护性更高，也符合当前需求复杂度。

### 9.3 文件存储
- 上传源文件存储到 `backend/storage/uploads/`
- 导出结果存储到 `backend/storage/exports/`
- 文件命名建议增加时间戳与批次号，避免覆盖

### 9.4 日志设计
按天生成日志文件：
- `backend/log/20260306.log`

日志至少记录：
- 接口请求
- 导入任务开始/结束
- 导出任务开始/结束
- 解析错误明细
- 规则执行异常

## 10. 开发步骤

### 第一阶段：项目初始化
1. 初始化 `backend` Python 项目，使用 `uv` 管理依赖。
2. 初始化 `frontend` React 项目。
3. 建立基础目录结构。
4. 配置 SQLite、日志、文件存储目录。
5. 补充基础 README。

### 第二阶段：后端基础能力
1. 搭建 Web 服务入口 `uv run main.py`。
2. 建立配置文件与日志初始化逻辑。
3. 建立 SQLite 表结构。
4. 实现统一响应结构与异常处理。
5. 实现文件上传能力。

### 第三阶段：解析配置模块
1. 实现解析配置 CRUD。
2. 实现样本 Excel 预览接口。
3. 实现配置保存与版本管理。
4. 完成前端框选交互页。

### 第四阶段：模板规则模块
1. 设计规则 Excel 导入格式。
2. 实现按 sheet 导入预览与批量创建。
3. 实现动态规则项与动态导出配置入库。
4. 实现规则编辑与启停。
5. 完成前端规则管理页。

### 第五阶段：明细导入模块
1. 实现 Excel 读取器。
2. 实现解析引擎。
3. 实现导入批次与明细入库。
4. 实现异常行返回与任务状态。

### 第六阶段：规则处理与导出模块
1. 实现规则引擎。
2. 实现预览接口。
3. 实现导出 Excel 能力。
4. 完成导出历史与下载。

### 第七阶段：任务中心与可观测性
1. 统一任务状态模型。
2. 建立任务中心页面。
3. 增加错误详情与重试能力。
4. 完善日志与问题排查路径。

### 第八阶段：联调与验收
1. 使用 `docs` 下样例 Excel 进行全链路验证。
2. 验证不同解析配置下的数据兼容性。
3. 验证模板规则结果与银行模板一致性。
4. 验证导出文件格式、字段顺序、汇总结果。

### 第九阶段：二期扩展
1. 对接商户额度查询数据源。
2. 增加 AI 客服消息入口。
3. 增加定时报表生成与发送能力。

## 11. 里程碑建议

### M1：基础可运行骨架
- 前后端项目初始化完成
- 服务可以启动
- SQLite 与日志目录可用

### M2：配置可管理
- 解析配置可新建、编辑、预览
- 模板规则可导入、查看、编辑

### M3：数据可导入
- 明细 Excel 可按配置解析并入库
- 导入结果可回看

### M4：结果可生成
- 可按规则生成预览数据
- 可导出标准 Excel

### M5：业务可验收
- 使用真实样例跑通对账流程
- 输出文件满足银行模板要求

## 12. 验收标准

### 功能验收
- 能上传明细 Excel 并按解析配置正确读取。
- 能上传模板规则并转成系统可执行规则。
- 能基于规则预览处理结果。
- 能导出符合模板要求的 Excel 文件。
- 能在任务中心查看导入与导出结果。

### 非功能验收
- `uv run main.py` 可启动后端服务。
- SQLite 数据文件保存在 `backend/db/`。
- 日志按天保存在 `backend/log/`。
- 导入失败时可定位到具体批次与错误信息。
- 规则变更不需要修改核心解析代码。

## 13. 风险与应对

### 风险一：Excel 格式差异大
应对：
- 通过解析配置显式定义表头、数据起始行、结束列
- 保存样本快照，支持调试与回放

### 风险二：规则复杂度失控
应对：
- 本期仅支持有限规则类型
- 每种规则类型单独实现执行器，避免脚本化失控

### 风险三：银行模板频繁变化
应对：
- 规则集版本化
- 模板规则与明细解析解耦

### 风险四：后续 AI 客服接入成本高
应对：
- 预留商户查询服务接口
- 查询逻辑与聊天渠道适配器分离

## 14. 推荐开发优先级
1. 后端基础骨架
2. 解析配置管理
3. 明细导入
4. 模板规则管理
5. 预览与导出
6. 任务中心
7. AI 客服查询

## 15. 当前文档结论
当前仓库尚未开始正式开发，建议先完成 MVP 主链路：
- 解析配置
- 模板规则
- 明细导入
- 预览导出
- 任务中心

AI 客服查询能力放到二期接入，避免本期同时处理 Excel 平台建设和外部聊天集成，控制复杂度，提升交付确定性。
