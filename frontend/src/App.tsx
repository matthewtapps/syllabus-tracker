import './index.css'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import LoginPage from './app/login/page';
import { ThemeProvider } from './components/theme/theme-provider';

function App() {
  return (
    <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
      <Router>
        <Routes>
          <Route path="/ui" element={<LoginPage />} />
          <Route path="/ui/login" element={<LoginPage />} />
        </Routes>
      </Router>
    </ThemeProvider>
  )
}

export default App
