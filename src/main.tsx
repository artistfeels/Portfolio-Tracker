import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// 초기 테마 설정 (기본값: 다크). 깜빡임 방지를 위해 렌더 전에 적용.
const savedTheme = localStorage.getItem('portfolio_theme') ?? 'dark'
document.documentElement.setAttribute('data-theme', savedTheme)

// StrictMode 제거 — 개발환경에서 이중 실행으로 KIS API 과호출 유발
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
