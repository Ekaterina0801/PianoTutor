from fastapi import APIRouter
from pathlib import Path
import json
router = APIRouter(tags=["exercises"])

DATA = Path(__file__).resolve().parents[2] / "data" / "exercises.json"
EX = json.loads(DATA.read_text(encoding="utf-8"))

@router.get("/exercises")
def list_exercises():
    return EX

@router.get("/exercises/{exercise_id}")
def get_exercise(exercise_id: str):
    for e in EX:
        if e["id"] == exercise_id:
            return e
    return EX[0]
