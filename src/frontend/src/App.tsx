import type { HealthResponse } from "@repo/shared";

const sample: HealthResponse = {
  status: "ok",
  service: "backend",
  timestamp: new Date().toISOString()
};

export function App() {
  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", margin: "2rem" }}>
      <h1>Anonymous University Platform with ZKP</h1>
      <p>Monorepo scaffold is ready.</p>
      <pre>{JSON.stringify(sample, null, 2)}</pre>
    </main>
  );
}
