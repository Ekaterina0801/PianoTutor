from app.models import CreateSessionRequest, NoteEvent
from app.routers.sessions import score_session


def test_score_endpoint_payload_returns_summary_without_auth_dependency():
    note = NoteEvent(onset_s=0.0, offset_s=0.5, midi_note=60, velocity=90)
    body = score_session(
        CreateSessionRequest(
            exercise_id="test",
            source="midi",
            performed=[note],
            expected=[note],
            onset_tol_s=0.12,
            assistant="off",
            aligner="offset",
        )
    )

    assert body["summary"]["f1"] == 1.0
    assert body["pipeline"]["assistant"]["decision"] == "off"
    assert body["pipeline"]["assistant"]["diagnostics"]["mode"] == "off"
    assert len(body["events"]["matches"]) == 1
