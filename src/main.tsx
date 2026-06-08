import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// StrictMode 제거 — 개발환경에서 이중 실행으로 KIS API 과호출 유발
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
