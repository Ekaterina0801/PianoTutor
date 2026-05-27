import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import init_db
from app.deps import get_current_user, require_roles
from app.models import CreateSessionRequest, LoginRequest, NoteEvent, RegisterRequest, ResearchRunRequest
from app.routers import analysis, auth, exercises, health, research, sessions


@pytest.fixture()
def isolated_db(tmp_path, monkeypatch):
    import app.db as db

    db.DATABASE_URL = f"sqlite:///{tmp_path / 'app_test.db'}"
    monkeypatch.setenv("DATABASE_URL", db.DATABASE_URL)
    init_db()


def auth_user(email: str = "student@piano.local") -> dict:
    response = auth.login(LoginRequest(email=email, password="demo1234"))
    return get_current_user(f"Bearer {response.access_token}")


def expect_http_error(status_code: int, fn, *args, **kwargs):
    with pytest.raises(HTTPException) as exc:
        fn(*args, **kwargs)
    assert exc.value.status_code == status_code
    return exc.value


def note(onset: float, midi: int, duration: float = 0.5, velocity: int = 90) -> NoteEvent:
    return NoteEvent(
        onset_s=onset,
        offset_s=onset + duration,
        midi_note=midi,
        velocity=velocity,
    )


def session_request(expected: list[NoteEvent], performed: list[NoteEvent], **kwargs) -> CreateSessionRequest:
    return CreateSessionRequest(
        exercise_id=kwargs.pop("exercise_id", "scale_c_major"),
        source=kwargs.pop("source", "midi"),
        performed=performed,
        expected=expected,
        onset_tol_s=kwargs.pop("onset_tol_s", 0.12),
        assistant=kwargs.pop("assistant", "off"),
        aligner=kwargs.pop("aligner", "offset"),
    )


def test_health_and_exercises_are_available(isolated_db):
    status = health.health()
    assert status["ok"] is True
    assert "correctors" in status

    payload = exercises.list_exercises()
    assert payload
    assert any(item["id"] == "scale_c_major" for item in payload)

    exercise = exercises.get_exercise("scale_c_major")
    assert exercise["midi_url"].endswith(".mid")


def test_auth_register_roles_and_me(isolated_db):
    student = auth_user()
    assert student["role"] == "student"

    expect_http_error(403, require_roles("teacher", "researcher", "admin"), current_user=student)

    registered = auth.register(
        RegisterRequest(
            email="new.student@example.test",
            password="demo1234",
            name="Новый студент",
            role="student",
        )
    )
    assert registered.user.role == "student"

    expect_http_error(
        403,
        auth.register,
        RegisterRequest(
            email="teacher-public@example.test",
            password="demo1234",
            name="Teacher",
            role="teacher",
        ),
    )

    admin = auth_user("admin@piano.local")
    created = auth.create_user(
        RegisterRequest(
            email="teacher.created@example.test",
            password="demo1234",
            name="Созданный преподаватель",
            role="teacher",
        ),
        current_user=admin,
    )
    assert created.role == "teacher"


def test_score_create_list_and_details_flow(isolated_db):
    expected = [note(0.0, 60), note(0.5, 62), note(1.0, 64)]
    performed = [note(0.01, 60), note(0.51, 62), note(1.01, 64)]

    scored = sessions.score_session(session_request(expected, performed))
    assert scored["summary"]["f1"] == 1.0
    assert scored["pipeline"]["assistant"]["decision"] == "off"
    assert len(scored["events"]["matches"]) == 3

    student = auth_user()
    created = sessions.create_session(
        session_request(expected, performed, assistant="heuristic", aligner="safe_linear_dtw"),
        current_user=student,
    )
    session_id = created["session_id"]
    assert created["summary"]["f1"] == 1.0

    rows = sessions.list_sessions(current_user=student)
    assert any(row["id"] == session_id for row in rows)

    details = sessions.get_session_details(session_id, current_user=student)
    assert details["metrics"]["assistant_mode"] == "heuristic"
    assert details["events"]["expected"]
    assert details["pipeline"]["postprocessing"]


def test_teacher_can_read_student_sessions_but_student_cannot_read_other_user(isolated_db):
    student = auth_user("student@piano.local")
    teacher = auth_user("teacher@piano.local")
    expected = [note(0.0, 60)]

    created = sessions.create_session(
        session_request(expected, expected),
        current_user=student,
    )
    assert created["session_id"]

    users = auth.list_users(current_user=teacher)
    student_id = next(row.id for row in users if row.email == "student@piano.local")

    teacher_view = sessions.list_sessions(user_id=student_id, current_user=teacher)
    assert teacher_view

    new_student = auth.register(
        RegisterRequest(
            email="other.student@example.test",
            password="demo1234",
            name="Другой студент",
            role="student",
        )
    )
    other_user = get_current_user(f"Bearer {new_student.access_token}")
    expect_http_error(403, sessions.list_sessions, user_id=student_id, current_user=other_user)


def test_transcribe_rejects_midi_upload_before_audio_pipeline(isolated_db):
    student = auth_user()
    upload = SimpleNamespace(filename="take.mid", content_type="application/octet-stream")

    err = expect_http_error(
        415,
        lambda: asyncio.run(analysis.transcribe(file=upload, current_user=student)),
    )
    assert "MIDI" in err.detail


def test_research_flow_requires_role_and_persists_run(isolated_db):
    student = auth_user("student@piano.local")
    researcher = auth_user("researcher@piano.local")

    expect_http_error(403, require_roles("researcher", "admin"), current_user=student)
    status = research.model_status(current_user=researcher)
    assert "corrector_checkpoints" in status

    benchmark = research.run_benchmark(
        ResearchRunRequest(
            name="test-benchmark",
            samples=4,
            seed=11,
            seed_count=1,
            assistant_modes=["off", "heuristic"],
            aligner_modes=["offset"],
            jitter_s=0.02,
            miss_prob=0.05,
            extra_prob=0.05,
        ),
        current_user=researcher,
    )
    run_id = benchmark["id"]
    assert benchmark["status"] == "completed"
    assert benchmark["metrics"]["leaderboard"]

    runs = research.list_runs(current_user=researcher)
    assert any(row["id"] == run_id for row in runs)

    details = research.get_run(run_id, current_user=researcher)
    assert details["artifacts"]["rows"]
