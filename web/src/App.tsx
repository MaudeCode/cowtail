import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Roundup from "./pages/Roundup";
import Fixes from "./pages/Fixes";
import AlertDetailsPage from "./pages/AlertDetailsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/alerts/:alertId" element={<AlertDetailsPage />} />
        <Route path="/roundup" element={<Roundup />} />
        <Route path="/fixes" element={<Fixes />} />
      </Routes>
    </BrowserRouter>
  );
}
