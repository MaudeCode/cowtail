import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Digest from './pages/Digest';
import Fixes from './pages/Fixes';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/digest" element={<Digest />} />
        <Route path="/fixes" element={<Fixes />} />
      </Routes>
    </BrowserRouter>
  );
}
