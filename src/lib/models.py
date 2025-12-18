"""Pydantic models for API request/response validation."""
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator
from lib.constants import AUDIO_EXTENSIONS, DEMUCS_MODELS, QUALITY_PRESETS, STEM_MODES


# Shared validator functions
def validate_stem_mode_value(v: Optional[str]) -> Optional[str]:
    """Validate stem_mode against STEM_MODES constants."""
    if v is not None and v not in STEM_MODES:
        return None  # Invalid modes are ignored
    return v


def validate_model_value(v: Optional[str]) -> Optional[str]:
    """Validate demucs_model against DEMUCS_MODELS constants."""
    if v is not None and v not in DEMUCS_MODELS:
        return None
    return v


def validate_model_value_strict(v: str) -> str:
    """Validate demucs_model with strict error raising."""
    if v not in DEMUCS_MODELS:
        raise ValueError(f"Unknown model: {v}")
    return v


def validate_quality_preset_value(v: Optional[str]) -> Optional[str]:
    """Validate quality_preset against QUALITY_PRESETS constants."""
    if v is not None and v not in QUALITY_PRESETS:
        return None  # Invalid presets are ignored
    return v


class AddQueueRequest(BaseModel):
    """Request to add YouTube URLs to queue."""
    urls: List[str] = Field(..., min_length=1)
    folder: Optional[str] = None
    stem_mode: Optional[str] = None

    @field_validator('stem_mode')
    @classmethod
    def validate_stem_mode(cls, v):
        return validate_stem_mode_value(v)


class AddQueueLocalRequest(BaseModel):
    """Request to add local files to queue."""
    files: List[str] = Field(..., min_length=1)
    folder: Optional[str] = None
    stem_mode: Optional[str] = None

    @field_validator('stem_mode')
    @classmethod
    def validate_stem_mode(cls, v):
        return validate_stem_mode_value(v)


class ConcurrencyRequest(BaseModel):
    """Request to set concurrency."""
    max: int = Field(..., ge=1, le=64)


class ConfigUpdateRequest(BaseModel):
    """Request to update configuration."""
    output_dir: Optional[str] = None
    default_folder: Optional[str] = None
    demucs_model: Optional[str] = None
    stem_mode: Optional[str] = None
    quality_preset: Optional[str] = None

    @field_validator('demucs_model')
    @classmethod
    def validate_model(cls, v):
        return validate_model_value(v)

    @field_validator('stem_mode')
    @classmethod
    def validate_stem_mode(cls, v):
        return validate_stem_mode_value(v)

    @field_validator('quality_preset')
    @classmethod
    def validate_quality_preset(cls, v):
        return validate_quality_preset_value(v)


class ModelDownloadRequest(BaseModel):
    """Request to download a model."""
    model: str

    @field_validator('model')
    @classmethod
    def validate_model(cls, v):
        return validate_model_value_strict(v)
