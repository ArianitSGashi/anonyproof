export interface HealthResponse {
  status: "ok";
  service: "backend";
  timestamp: string;
}

export interface ApiError {
  message: string;
  code: string;
}
