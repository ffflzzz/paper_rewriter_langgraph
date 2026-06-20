/**
 * CopilotKit Runtime Server (Express)
 * 作为前端和AG-UI后端之间的代理层
 */
import express from "express";
import cors from "cors";
import {
  CopilotRuntime,
  copilotRuntimeNodeExpressEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

const app = express();
app.use(cors());
app.use(express.json());

// AG-UI后端地址
const AGUI_BACKEND_URL = process.env.AGUI_BACKEND_URL || "http://localhost:8765";

// 创建LangGraph agent配置
const langGraphAgent = new LangGraphHttpAgent({
  url: AGUI_BACKEND_URL + "/api/copilotkit",
  agentId: "paper_rewriter",
});

// 创建CopilotKit Runtime
const runtime = new CopilotRuntime({
  agents: {
    paper_rewriter: langGraphAgent,
  },
});

// 直接挂载到根路径 — endpoint参数告诉runtime它被挂载在哪个路径下
app.use(copilotRuntimeNodeExpressEndpoint({
  runtime,
  endpoint: "/api/copilotkit",
}));

const PORT = process.env.PORT || 8766;
app.listen(PORT, () => {
  console.log(`CopilotKit Runtime running on http://localhost:${PORT}`);
  console.log(`Connected to AG-UI backend: ${AGUI_BACKEND_URL}`);
});

// 防止未捕获异常导致进程崩溃
process.on('uncaughtException', (err) => {
  console.error('[Runtime] Uncaught exception (continuing):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Runtime] Unhandled rejection (continuing):', reason?.message || reason);
});
