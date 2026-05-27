from fastapi import APIRouter
from app.assistant.checkpoints import corrector_checkpoint_status
router = APIRouter(tags=["health"])
@router.get("/health")
def health():
    status = corrector_checkpoint_status()
    return {
        "ok": True,
        "service": "piano-tutor-api",
        "tcn_checkpoint_ready": status["tcn"]["available"],
        "correctors": status,
    }
