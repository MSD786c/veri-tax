import { Navigate, Route, Routes } from "react-router-dom";
import { RequireRole } from "./auth.tsx";
import { Shell } from "./components/Layout.tsx";
import Home from "./pages/Home.tsx";
import ApplicationDetail from "./pages/fta/ApplicationDetail.tsx";
import Applications from "./pages/fta/Applications.tsx";
import Overview from "./pages/fta/Overview.tsx";
import Rejections from "./pages/fta/Rejections.tsx";
import SupplierDetail from "./pages/fta/SupplierDetail.tsx";
import Suppliers from "./pages/fta/Suppliers.tsx";
import MaskanSubmit from "./pages/maskan/Submit.tsx";
import BulkUpload from "./pages/supplier/BulkUpload.tsx";
import Queue from "./pages/supplier/Queue.tsx";
import RequestDetail from "./pages/supplier/RequestDetail.tsx";

const SUPPLIER_NAV = [
  { to: "/supplier", label: "Confirmations", end: true },
  { to: "/supplier/upload", label: "CSV upload" },
];
const FTA_NAV = [
  { to: "/fta", label: "Overview", end: true },
  { to: "/fta/applications", label: "Applications" },
  { to: "/fta/suppliers", label: "Suppliers" },
  { to: "/fta/rejections", label: "Rejections" },
];

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/supplier"
        element={
          <RequireRole role="supplier">
            <Shell area="Supplier portal" nav={SUPPLIER_NAV} />
          </RequireRole>
        }
      >
        <Route index element={<Queue />} />
        <Route path="requests/:id" element={<RequestDetail />} />
        <Route path="upload" element={<BulkUpload />} />
      </Route>
      <Route
        path="/fta"
        element={
          <RequireRole role="officer">
            <Shell area="FTA dashboard" nav={FTA_NAV} />
          </RequireRole>
        }
      >
        <Route index element={<Overview />} />
        <Route path="applications" element={<Applications />} />
        <Route path="applications/:id" element={<ApplicationDetail />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="suppliers/:trn" element={<SupplierDetail />} />
        <Route path="rejections" element={<Rejections />} />
      </Route>
      <Route path="/maskan" element={<Shell area="Maskan simulator" nav={[{ to: "/maskan", label: "New application", end: true }]} />}>
        <Route index element={<MaskanSubmit />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
