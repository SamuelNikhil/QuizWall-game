import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Screen from './pages/Screen';
import Controller from './pages/Controller';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Screen />} />
        <Route path="/screen" element={<Screen />} />
        <Route path="/controller/:roomId/:token" element={<Controller />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
