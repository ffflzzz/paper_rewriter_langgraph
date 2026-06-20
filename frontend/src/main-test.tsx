import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// 简单测试，不加载CopilotKit
function TestApp() {
  return (
    <div style={{ padding: '20px', color: 'white', background: '#1a1a2e', minHeight: '100vh' }}>
      <h1>论文重写 · 多Agent系统</h1>
      <p>React 渲染正常 ✓</p>
      <p>连接状态检查中...</p>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TestApp />
  </StrictMode>,
)
