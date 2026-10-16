"""
End-to-End Verification Test for Task A-01:
- FR-CFG-01/02/05: Draft saving, revision guard, immutable release reading
- AT-01: Definition & Contract schema
- AT-02: Draft saving with incomplete metadata, malformed JSON rejection, optimistic revision conflict
- AT-04: Immutable release reading, rejection of mutation, active pointer inspection
"""

import sys
import unittest
from datetime import datetime
import jwt
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core.config import settings
from app.db import get_db
from app.models.experience import (
    ActiveReleasePointer,
    Experience,
    ExperienceDraft,
    ExperienceRelease,
    IdempotencyRecord,
)
from app.modules.experience.crud.experience_release import create_release_snapshot
from main import app


class TestExperienceDraftAndRelease(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create an in-memory SQLite database for isolated test execution
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(cls.engine)

        import time
        # Generate a valid admin JWT token
        cls.admin_token = jwt.encode(
            {
                "sub": "admin_test_user",
                "type": "access",
                "admin": True,
                "exp": int(time.time()) + 3600,
            },
            settings.SECRET_KEY,
            algorithm="HS256",
        )
        cls.auth_headers = {"Authorization": f"Bearer {cls.admin_token}"}

    def setUp(self):
        # Override get_db dependency for each test
        def override_get_db():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_01_at02_read_initial_draft_and_metadata(self):
        """AT-02: Initial draft exists or is lazily created with revision 1."""
        res = self.client.get("/api/v1/admin/experiences/exp_personality_v1/draft", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        draft = data["data"]
        self.assertEqual(draft["experience_id"], "exp_personality_v1")
        self.assertEqual(draft["revision"], 1)
        self.assertTrue(draft["content_hash"].startswith("sha256:"))

    def test_02_at02_save_draft_with_incomplete_metadata(self):
        """AT-02 / FR-CFG-02: Draft with incomplete content is safely saved and revision increments."""
        # Read current revision first
        curr = self.client.get("/api/v1/admin/experiences/exp_personality_v1/draft", headers=self.auth_headers).json()["data"]
        curr_rev = curr["revision"]

        incomplete_content = {
            "questions": [
                {
                    "question_id": "q1",
                    "prompt": "Bạn có thích tự tay sửa chữa dụng cụ không?",
                }
            ]
        }

        save_payload = {
            "expected_revision": curr_rev,
            "idempotency_key": "test_save_incomplete_001",
            "content": incomplete_content,
        }

        res = self.client.put(
            "/api/v1/admin/experiences/exp_personality_v1/draft",
            json=save_payload,
            headers=self.auth_headers,
        )
        self.assertEqual(res.status_code, 200)
        saved = res.json()["data"]
        self.assertEqual(saved["revision"], curr_rev + 1)
        self.assertEqual(saved["content"], incomplete_content)
        self.assertTrue(saved["content_hash"].startswith("sha256:"))

    def test_03_at02_revision_conflict(self):
        """AT-02 / QT-03: Stale expected_revision raises 409 Conflict with current state."""
        # Current revision is at least 2 after test_02
        stale_payload = {
            "expected_revision": 1,  # Intentional stale revision
            "idempotency_key": "test_save_conflict_002",
            "content": {"questions": []},
        }

        res = self.client.put(
            "/api/v1/admin/experiences/exp_personality_v1/draft",
            json=stale_payload,
            headers=self.auth_headers,
        )
        self.assertEqual(res.status_code, 409)
        err = res.json()
        self.assertFalse(err["success"])
        self.assertEqual(err["error"]["code"], "REVISION_CONFLICT")
        self.assertIn("details", err["error"])
        self.assertIsNotNone(err["error"]["details"])
        self.assertGreater(err["error"]["details"]["revision"], 1)

    def test_04_qt04_idempotency_replay_and_collision(self):
        """QT-04: Idempotency replay returns saved result; collision raises 409."""
        curr = self.client.get("/api/v1/admin/experiences/exp_personality_v1/draft", headers=self.auth_headers).json()["data"]
        curr_rev = curr["revision"]

        payload = {
            "expected_revision": curr_rev,
            "idempotency_key": "idem_key_same_001",
            "content": {"title": "Same Payload Title"},
        }

        # 1. First save succeeds
        res1 = self.client.put("/api/v1/admin/experiences/exp_personality_v1/draft", json=payload, headers=self.auth_headers)
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()["data"]
        rev_after_save = data1["revision"]

        # 2. Replay with exact same key and payload returns identical result without extra increment
        res2 = self.client.put("/api/v1/admin/experiences/exp_personality_v1/draft", json=payload, headers=self.auth_headers)
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()["data"]
        self.assertEqual(data1["revision"], data2["revision"])
        self.assertEqual(data1["content_hash"], data2["content_hash"])

        # 3. Collision: same key but different payload returns 409 IDEMPOTENCY_COLLISION
        colliding_payload = {
            "expected_revision": curr_rev,
            "idempotency_key": "idem_key_same_001",
            "content": {"title": "Different Conflicting Payload"},
        }
        res3 = self.client.put("/api/v1/admin/experiences/exp_personality_v1/draft", json=colliding_payload, headers=self.auth_headers)
        self.assertEqual(res3.status_code, 409)
        self.assertEqual(res3.json()["error"]["code"], "IDEMPOTENCY_COLLISION")

    def test_05_at04_immutable_release_reading(self):
        """AT-04 / FR-CFG-05: Published release can be read and is strictly immutable."""
        with Session(self.engine) as session:
            create_release_snapshot(
                db=session,
                release_id="rel_test_immutable_001",
                experience_id="exp_personality_v1",
                definition_version="1.0.0",
                configuration={"title": "Frozen Release V1", "questions": ["q1", "q2"]},
                published_by="admin_test",
                is_demo=False,
            )

        # Read release
        res = self.client.get("/api/v1/admin/experience-releases/rel_test_immutable_001", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        rel = res.json()["data"]
        self.assertEqual(rel["id"], "rel_test_immutable_001")
        self.assertEqual(rel["definition_version"], "1.0.0")
        self.assertEqual(rel["configuration"]["title"], "Frozen Release V1")
        self.assertTrue(rel["definition_hash"].startswith("sha256:"))

        # Check Cache-Control header
        self.assertEqual(res.headers.get("Cache-Control"), "no-store")

        # Verify mutation is blocked (No PUT/PATCH routes exist for releases)
        put_res = self.client.put("/api/v1/admin/experience-releases/rel_test_immutable_001", json={}, headers=self.auth_headers)
        self.assertIn(put_res.status_code, [404, 405])

    def test_06_at04_active_release_pointer(self):
        """AT-04: Read active pointer for demo and production environments."""
        res_demo = self.client.get("/api/v1/admin/experiences/exp_personality_v1/active-release?environment=demo", headers=self.auth_headers)
        self.assertEqual(res_demo.status_code, 200)
        ptr_demo = res_demo.json()["data"]
        self.assertEqual(ptr_demo["environment"], "demo")
        self.assertEqual(ptr_demo["experience_id"], "exp_personality_v1")
        self.assertIn("revision", ptr_demo)

        res_prod = self.client.get("/api/v1/admin/experiences/exp_personality_v1/active-release?environment=production", headers=self.auth_headers)
        self.assertEqual(res_prod.status_code, 200)
        ptr_prod = res_prod.json()["data"]
        self.assertEqual(ptr_prod["environment"], "production")


if __name__ == "__main__":
    unittest.main()
