# Paper Rewriter -> AG-UI + CopilotKit 改造计划

**Goal:** 将论文重写 LangGraph 项目从自定义 SSE dashboard 改造为 AG-UI 标准协议 + CopilotKit 前端

**Architecture:**
- 后端：保留现有 LangGraph pipeline，在 server/app.py 增加 AG-UI endpoint
- 前端：用 CopilotKit React 组件替换现有 HTML dashboard
- 部署：React build 产物由 FastAPI 静态服务

**Tech Stack:** LangGraph, copilotkit (Python), FastAPI, React, CopilotKit (@copilotkit/react-ui), Vite, Tailwind CSS

## 执行步骤

### Task 1: 安装 Python 依赖
- pip install copilotkit
- 更新 requirements.txt

### Task 2: 创建 AG-UI Agent 包装器
- Create: server/agui_agent.py
- 用 CopilotKit SDK 的 LangGraphAGUIAgent 包装现有 graph

### Task 3: 在 app.py 中集成 AG-UI endpoint
- 调用 setup_agui_endpoint(app)
- 与旧 SSE 端点并存

### Task 4: 创建 React 前端项目
- Vite + React + CopilotKit + Tailwind CSS
- 安装 @copilotkit/react-ui, @copilotkit/react-core

### Task 5: 编写 CopilotKit 前端页面
- CopilotKit + CopilotSidebar 组件
- Vite proxy 配置

### Task 6: FastAPI serve React build 产物
- 配置静态文件 mount

### Task 7: 更新 abcyesno.cn 反向代理
- 更新 paper-rewriter.html

### Task 8: 端到端测试
