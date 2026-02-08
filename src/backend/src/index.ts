import cors from "cors";
import express from "express";
import type { HealthResponse } from "@repo/shared";

const app = express();
const port = Number(process.env["PORT"] ?? 3001);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  const payload: HealthResponse = {
    status: "ok",
    service: "backend",
    timestamp: new Date().toISOString()
  };

  res.status(200).json(payload);
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
