import { ErrorState } from "@/components/states";

export default function NotFound() {
  return (
    <div className="login-form" style={{ minHeight: "100vh" }}>
      <ErrorState code={404} title="We can't find that page" text="The link may be old, or the record may have been removed." />
    </div>
  );
}
