from __future__ import annotations

import datetime
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import connect
from app.deps import get_current_user, require_roles


router = APIRouter(tags=["assignments"])


class AssignmentCreate(BaseModel):
    student_id: str
    exercise_id: str
    note: str = ""
    due_at: Optional[str] = None


@router.get("/assignments")
def list_assignments(current_user=Depends(get_current_user)):
    conn = connect()
    if current_user["role"] == "student":
        rows = conn.execute("SELECT * FROM assignments WHERE student_id=? ORDER BY created_at DESC", (current_user["id"],)).fetchall()
    elif current_user["role"] == "teacher":
        rows = conn.execute("SELECT * FROM assignments WHERE teacher_id=? ORDER BY created_at DESC", (current_user["id"],)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM assignments ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/assignments")
def create_assignment(req: AssignmentCreate, current_user=Depends(require_roles("teacher", "admin"))):
    conn = connect()
    student = conn.execute("SELECT id FROM users WHERE id=? AND role='student'", (req.student_id,)).fetchone()
    if not student:
        conn.close()
        raise HTTPException(status_code=404, detail="Student not found")
    aid = str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + "Z"
    conn.execute(
        """
        INSERT INTO assignments (id,teacher_id,student_id,exercise_id,note,due_at,status,created_at)
        VALUES (?,?,?,?,?,?,?,?)
        """,
        (aid, current_user["id"], req.student_id, req.exercise_id, req.note, req.due_at, "active", now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM assignments WHERE id=?", (aid,)).fetchone()
    conn.close()
    return dict(row)
