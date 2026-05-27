from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any

class NoteEvent(BaseModel):
    onset_s: float
    offset_s: float
    midi_note: int
    velocity: int

UserRole = Literal["student", "teacher", "researcher", "admin"]
AssistantMode = Literal["off", "heuristic", "tcn", "bilstm", "transformer", "experimental", "on"]
AlignerMode = Literal["offset", "linear_dtw", "safe_linear_dtw", "basic", "dtw"]

class Exercise(BaseModel):
    id: str
    title: str
    composer: Optional[str] = None
    difficulty: int = 1
    tempo_bpm: Optional[int] = None
    midi_url: str
    tags: List[str] = []

class CreateSessionRequest(BaseModel):
    user_id: Optional[str] = None
    exercise_id: str
    source: Literal["midi","mic"]
    performed: List[NoteEvent]
    expected: List[NoteEvent]
    onset_tol_s: float = 0.12
    assistant: AssistantMode = "heuristic"
    aligner: AlignerMode = "safe_linear_dtw"

class CreateSessionResponse(BaseModel):
    session_id: str
    summary: Dict[str, Any]

class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1)

class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=120)
    role: UserRole = "student"

class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    role: UserRole
    is_active: bool = True

class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic

class ResearchRunRequest(BaseModel):
    name: str = "synthetic-mini-benchmark"
    samples: int = Field(default=24, ge=4, le=240)
    seed: int = 42
    seed_count: int = Field(default=5, ge=1, le=20)
    assistant_modes: List[AssistantMode] = ["off", "heuristic", "tcn", "bilstm", "transformer", "experimental"]
    aligner_modes: List[AlignerMode] = ["offset", "linear_dtw", "safe_linear_dtw"]
    jitter_s: float = Field(default=0.045, ge=0.0, le=0.5)
    miss_prob: float = Field(default=0.08, ge=0.0, le=0.8)
    extra_prob: float = Field(default=0.06, ge=0.0, le=0.8)
