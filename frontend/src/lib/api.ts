import type { AuthResponse, Exercise, CreateSessionRequest, CreateSessionResponse, NoteEvent, ResearchRunRequest, ScorePerformanceResponse, User } from "@/lib/types";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

function token() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("pt_token") || "";
}

function headers(extra?: HeadersInit): HeadersInit {
  const t = token();
  return { ...(extra || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

function request(input: string, init: RequestInit = {}) {
  return fetch(input, { credentials: "include", ...init });
}

export const api = {
  async login(email: string, password: string): Promise<AuthResponse> {
    const r = await request(`${API_BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async register(email: string, password: string, name: string): Promise<AuthResponse> {
    const r = await request(`${API_BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, name, role: "student" }) });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async logout(): Promise<void> {
    await request(`${API_BASE}/api/auth/logout`, { method: "POST", headers: headers() });
  },
  async me(): Promise<User> {
    const r = await request(`${API_BASE}/api/auth/me`, { headers: headers() });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async users(): Promise<User[]> {
    const r = await request(`${API_BASE}/api/users`, { headers: headers() });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async exercises(): Promise<Exercise[]> {
    const r = await request(`${API_BASE}/api/exercises`);
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async exercise(id: string): Promise<Exercise> {
    const r = await request(`${API_BASE}/api/exercises/${id}`);
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async createSession(req: CreateSessionRequest): Promise<CreateSessionResponse> {
    const r = await request(`${API_BASE}/api/sessions`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(req) });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async scorePerformance(req: CreateSessionRequest): Promise<ScorePerformanceResponse> {
    const r = await request(`${API_BASE}/api/sessions/score`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(req) });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async sessions(user_id?: string): Promise<any[]> {
    const qs = user_id ? `?user_id=${encodeURIComponent(user_id)}` : "";
    const r = await request(`${API_BASE}/api/sessions${qs}`, { headers: headers() });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  
  async sessionDetails(id: string): Promise<any> {
    const r = await request(`${API_BASE}/api/sessions/${id}/details`, { headers: headers() });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },

  async session(id: string): Promise<any> {
    const r = await request(`${API_BASE}/api/sessions/${id}`, { headers: headers() });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async transcribe(file: File, maxDurationS = 20, expectedNotes?: NoteEvent[]): Promise<NoteEvent[]> {
    const fd = new FormData();
    fd.append("file", file);
    if (expectedNotes?.length) fd.append("expected_notes", JSON.stringify(expectedNotes));
    const qs = `?max_duration_s=${encodeURIComponent(String(maxDurationS))}`;
    const r = await request(`${API_BASE}/api/transcribe${qs}`, { method: "POST", headers: headers(), body: fd });
    if (!r.ok) {
      let message = "failed";
      try {
        const body = await r.json();
        message = body?.detail || message;
      } catch {}
      throw new Error(message);
    }
    return r.json();
  },
  async researchStatus(): Promise<any> {
    const r = await request(`${API_BASE}/api/research/model-status`, { headers: headers() });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async runBenchmark(req: ResearchRunRequest): Promise<any> {
    const r = await request(`${API_BASE}/api/research/benchmark`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(req) });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async researchRuns(): Promise<any[]> {
    const r = await request(`${API_BASE}/api/research/runs`, { headers: headers() });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
  async assignments(): Promise<any[]> {
    const r = await request(`${API_BASE}/api/assignments`, { headers: headers() });
    if (!r.ok) throw new Error("failed");
    return r.json();
  },
};
