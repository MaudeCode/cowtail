import { itemListResponseSchema } from "@maudecode/cowtail-protocol";
import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";

import Layout from "./components/app/Layout";
import { itemPath } from "./components/items/ItemRow";
import { Empty, QueryError } from "./components/ui";
import { api } from "./lib/api";
import { sessionQuery } from "./lib/queries";
import Cluster from "./pages/Cluster";
import History from "./pages/History";
import Home from "./pages/Home";
import ItemDetail from "./pages/ItemDetail";
import Login from "./pages/Login";
import Roundup from "./pages/Roundup";
import Settings from "./pages/Settings";

// Pushes and older links open an alert; its item is the page now.
function AlertRedirect() {
  const { alertId = "" } = useParams();
  const { data, error } = useQuery({
    queryKey: ["alert-item", alertId],
    queryFn: () =>
      api(`/api/items?alertId=${encodeURIComponent(alertId)}&limit=1`, itemListResponseSchema),
  });
  if (error) return <QueryError error={error} />;
  if (!data) return null;
  const item = data.items[0];
  return item ? (
    <Navigate to={itemPath(item.id)} replace />
  ) : (
    <Empty>No item for this alert.</Empty>
  );
}

// Without a session every address shows the login page.
export function AppRoutes() {
  const session = useQuery(sessionQuery);
  if (session.isPending) return null;
  if (session.error) return <QueryError error={session.error} />;
  if (session.data === null) return <Login />;

  return (
    <Routes>
      <Route path="/roundup" element={<Roundup />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/cluster" element={<Cluster />} />
        <Route path="/history" element={<History />} />
        <Route path="/items/:id" element={<ItemDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/alerts/:alertId" element={<AlertRedirect />} />
        <Route path="/fixes" element={<Navigate to="/history" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
