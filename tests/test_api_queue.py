"""Tests for queue API endpoints."""
import pytest
from unittest.mock import patch, MagicMock


class TestQueueEndpoints:
    """Test /api/queue endpoints."""

    def test_get_queue_empty(self, test_client):
        """Test getting empty queue."""
        response = test_client.get("/api/queue")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "running" in data

    def test_add_to_queue(self, test_client, mock_yt_dlp):
        """Test adding URLs to queue."""
        response = test_client.post("/api/queue", json={
            "urls": ["https://youtube.com/watch?v=test123"]
        })
        assert response.status_code == 200
        data = response.json()
        assert "added" in data
        assert len(data["added"]) == 1
        assert data["added"][0]["url"] == "https://youtube.com/watch?v=test123"

    def test_add_to_queue_empty_urls(self, test_client):
        """Test that empty URLs list is rejected."""
        response = test_client.post("/api/queue", json={
            "urls": []
        })
        assert response.status_code == 400  # Bad request

    def test_add_local_file(self, test_client, sample_audio_file):
        """Test adding local file to queue."""
        response = test_client.post("/api/queue-local", json={
            "files": [str(sample_audio_file)]
        })
        assert response.status_code == 200


class TestProgressEndpoint:
    """Test /api/progress endpoint."""

    def test_get_progress(self, test_client):
        """Test getting progress."""
        response = test_client.get("/api/progress")
        assert response.status_code == 200
        data = response.json()
        assert "counts" in data
        assert "concurrency" in data


class TestConcurrencyEndpoint:
    """Test /api/concurrency endpoints."""

    def test_get_concurrency(self, test_client):
        """Test getting concurrency."""
        response = test_client.get("/api/concurrency")
        assert response.status_code == 200
        data = response.json()
        assert "max" in data

    def test_set_concurrency(self, test_client):
        """Test setting concurrency."""
        response = test_client.post("/api/concurrency", json={"max": 8})
        assert response.status_code == 200
        data = response.json()
        assert data["max"] == 8

    def test_set_concurrency_out_of_range(self, test_client):
        """Test that out-of-range values are clamped."""
        response = test_client.post("/api/concurrency", json={"max": 100})
        assert response.status_code == 200
        data = response.json()
        assert data["max"] == 64  # Max limit
