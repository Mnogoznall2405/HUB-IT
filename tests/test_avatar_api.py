"""Tests for avatar upload/delete/serve API endpoints."""
from __future__ import annotations

import io
import sys
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

avatar_module = __import__("backend.api.v1.avatar", fromlist=["backend"])
auth_models_module = __import__("backend.models.auth", fromlist=["backend"])


def _build_test_user(user_id=42, username="test-user"):
    return auth_models_module.User(
        id=user_id,
        username=username,
        email=f"{username}@example.com",
        full_name="Test User",
        role="viewer",
        is_active=True,
        permissions=[],
        use_custom_permissions=False,
        custom_permissions=[],
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_signature_html=None,
        mail_is_configured=False,
    )


def _make_upload_file(content: bytes, filename: str = "avatar.png", content_type: str = "image/png") -> UploadFile:
    return UploadFile(filename=filename, file=io.BytesIO(content), headers=Headers({"content-type": content_type}))


def _mock_user_service(monkeypatch):
    """Mock user_service for avatar tests."""
    service = Mock()
    service.get_by_id = Mock(return_value=None)
    service.update_user = Mock(return_value={"id": 42, "username": "test-user", "avatar_url": "/api/v1/settings/avatar/42/file?v=1234567890"})
    monkeypatch.setattr(avatar_module, "user_service", service)
    return service


class TestAvatarUpload:
    """Tests for POST /settings/avatar"""

    @pytest.mark.asyncio
    async def test_rejects_non_image_files(self, monkeypatch):
        """Should reject files with non-image content types."""
        _mock_user_service(monkeypatch)
        current_user = _build_test_user()
        file = _make_upload_file(b"not an image", filename="document.pdf", content_type="application/pdf")

        with pytest.raises(Exception) as exc_info:
            await avatar_module.upload_avatar(file=file, current_user=current_user)
        
        assert "Unsupported file type" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_rejects_oversized_files(self, monkeypatch):
        """Should reject files larger than 5MB."""
        _mock_user_service(monkeypatch)
        current_user = _build_test_user()
        # Create fake oversized content (6MB)
        oversized_content = b"fake image data" * (6 * 1024 * 1024 // 16)
        file = _make_upload_file(oversized_content, filename="huge.jpg", content_type="image/jpeg")

        with pytest.raises(Exception) as exc_info:
            await avatar_module.upload_avatar(file=file, current_user=current_user)
        
        assert "File too large" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_processes_valid_image(self, monkeypatch, tmp_path):
        """Should process valid image and return avatar_url."""
        mock_service = _mock_user_service(monkeypatch)
        
        # Mock avatars dir to tmp_path
        monkeypatch.setattr(avatar_module, "_AVATARS_DIR", tmp_path)
        
        current_user = _build_test_user()
        
        # Create a valid test image using PIL
        from PIL import Image
        img = Image.new('RGB', (100, 100), color='red')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)
        
        file = _make_upload_file(img_bytes.getvalue(), filename="avatar.png", content_type="image/png")
        
        response = await avatar_module.upload_avatar(file=file, current_user=current_user)
        
        assert "avatar_url" in response
        assert response["avatar_url"].startswith("/api/v1/settings/avatar/42/file")
        assert "v=" in response["avatar_url"]
        mock_service.update_user.assert_called_once()
        
        # Verify file was written to tmp_path
        avatar_files = list(tmp_path.glob("42_*.webp"))
        assert len(avatar_files) == 1
        assert avatar_files[0].suffix == ".webp"


class TestAvatarDelete:
    """Tests for DELETE /settings/avatar"""

    @pytest.mark.asyncio
    async def test_deletes_avatar_successfully(self, monkeypatch, tmp_path):
        """Should delete avatar file and update user."""
        mock_service = _mock_user_service(monkeypatch)
        monkeypatch.setattr(avatar_module, "_AVATARS_DIR", tmp_path)
        
        # Create fake avatar file
        avatar_file = tmp_path / "42_abc123.webp"
        avatar_file.write_text("fake webp")
        
        current_user = _build_test_user()
        response = await avatar_module.delete_avatar(current_user=current_user)
        
        assert response["avatar_url"] is None
        mock_service.update_user.assert_called_once_with(42, avatar_url=None)
        assert not avatar_file.exists()


class TestAvatarServe:
    """Tests for GET /settings/avatar/{user_id}/file"""

    @pytest.mark.asyncio
    async def test_serves_existing_avatar(self, tmp_path):
        """Should serve existing avatar file."""
        monkeypatch = pytest.MonkeyPatch()
        monkeypatch.setattr(avatar_module, "_AVATARS_DIR", tmp_path)
        
        # Create fake avatar file
        avatar_file = tmp_path / "42_abc123.webp"
        avatar_file.write_bytes(b"fake webp content")
        
        response = await avatar_module.get_avatar_file(user_id=42)
        
        assert response.path == str(avatar_file)
        assert response.media_type == "image/webp"
        
        monkeypatch.undo()

    @pytest.mark.asyncio
    async def test_returns_404_for_missing_avatar(self):
        """Should return 404 when avatar doesn't exist."""
        with pytest.raises(Exception) as exc_info:
            await avatar_module.get_avatar_file(user_id=999)
        
        assert exc_info.value.status_code == 404
        assert "Avatar not found" in str(exc_info.value.detail)
