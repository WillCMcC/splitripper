"""Pydantic models for API request/response validation."""
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator
from lib.constants import AUDIO_EXTENSIONS, DEMUCS_MODELS, STEM_MODES


class AddQueueRequest(BaseModel):
    """Request to add YouTube URLs to queue."""
    urls: List[str] = Field(..., min_length=1)
    folder: Optional[str] = None
    stem_mode: Optional[str] = None

    @field_validator('stem_mode')
    @classmethod
    def validate_stem_mode(cls, v):
        if v is not None and v not in STEM_MODES:
            return None  # Invalid modes are ignored
        return v


class AddQueueLocalRequest(BaseModel):
    """Request to add local files to queue."""
    files: List[str] = Field(..., min_length=1)
    folder: Optional[str] = None
    stem_mode: Optional[str] = None

    @field_validator('stem_mode')
    @classmethod
    def validate_stem_mode(cls, v):
        if v is not None and v not in STEM_MODES:
            return None  # Invalid modes are ignored
        return v


class ConcurrencyRequest(BaseModel):
    """Request to set concurrency."""
    max: int = Field(..., ge=1, le=64)


class ConfigUpdateRequest(BaseModel):
    """Request to update configuration."""
    output_dir: Optional[str] = None
    default_folder: Optional[str] = None
    demucs_model: Optional[str] = None
    stem_mode: Optional[str] = None

    @field_validator('demucs_model')
    @classmethod
    def validate_model(cls, v):
        if v is not None and v not in DEMUCS_MODELS:
            return None
        return v

    @field_validator('stem_mode')
    @classmethod
    def validate_stem_mode(cls, v):
        if v is not None and v not in STEM_MODES:
            return None
        return v


class ModelDownloadRequest(BaseModel):
    """Request to download a model."""
    model: str

    @field_validator('model')
    @classmethod
    def validate_model(cls, v):
        if v not in DEMUCS_MODELS:
            raise ValueError(f"Unknown model: {v}")
        return v
