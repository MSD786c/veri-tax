import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { RequireRole } from "./auth.tsx";
import { Shell } from "./components/Layout.tsx";
import Home from "./pages/Home.tsx";
import ApplicationDetail from "./pages/fta/ApplicationDetail.tsx";
import Documents from "./pages/fta/Documents.tsx";
import Applications from "./pages/fta/Applications.tsx";
import Overview from "./pages/fta/Overview.tsx";
import Rejections from "./pages/fta/Rejections.tsx";
import SupplierDetail from "./pages/fta/SupplierDetail.tsx";
import Suppliers from "./pages/fta/Suppliers.tsx";
import ApplicantStatus from "./pages/maskan/ApplicantStatus.tsx";
import MaskanSubmit from "./pages/maskan/Submit.tsx";
import BulkUpload from "./pages/supplier/BulkUpload.tsx";
import Queue from "./pages/supplier/Queue.tsx";
import RequestDetail from "./pages/supplier/RequestDetail.tsx";

const SUPPLIER_NAV = [
  { to: "/supplier", label: "Confirmations", end: true },
  { to: "/supplier/upload", label: "CSV upload" },
];
const MASKAN_NAV = [
  { to: "/maskan", label: "New application", end: true },
  { to: "/maskan/status", label: "Applicant status" },
];
const FTA_NAV = [
  { to: "/fta", label: "Overview", end: true },
  { to: "/fta/applications", label: "Applications" },
  { to: "/fta/suppliers", label: "Suppliers" },
  { to: "/fta/documents", label: "Documents" },
  { to: "/fta/rejections", label: "Rejections" },
];

// FTA-only dev server (npm run fta): bare "/" goes straight to the FTA dashboard; sign-in redirects keep their query.
function Landing() {
  const { search } = useLocation();
  return import.meta.env.VITE_FTA_ONLY && !search ? <Navigate to="/fta" replace /> : <Home />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
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
        <Route path="documents" element={<Documents />} />
        <Route path="rejections" element={<Rejections />} />
      </Route>
      <Route path="/maskan" element={<Shell area="Maskan simulator" nav={MASKAN_NAV} />}>
        <Route index element={<MaskanSubmit />} />
        <Route path="status" element={<ApplicantStatus />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
