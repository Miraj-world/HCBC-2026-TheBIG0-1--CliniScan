from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


UrgencyLevel = Literal["low", "medium", "high"]
ConfidenceLevel = Literal["low", "medium", "high"]
ProviderType = Literal["anthropic", "openai"]
BodyRegion = Literal[
    "skin",
    "eye",
    "respiratory",
    "musculoskeletal",
    "gastrointestinal",
    "neurological",
    "other",
]

STANDARD_DISCLAIMER = "Not a diagnosis. Always consult a licensed medical professional."


class AnalyzeRequest(BaseModel):
    symptom_text: str = Field(min_length=10)
    body_location: str = Field(min_length=1)
    duration_days: int = Field(ge=0)
    severity_score: int = Field(ge=1, le=10)
    age: Optional[int] = Field(default=None, ge=0)
    known_conditions: Optional[str] = None
    medications: Optional[str] = None
    image_base64: Optional[str] = None
    image_mime: str = "image/jpeg"
    demo_scenario: Optional[int] = Field(default=None, ge=1, le=3)
    provider: ProviderType = "anthropic"


AnalyticsEventName = Literal[
    "page_view",
    "assessment_started",
    "assessment_completed",
    "assessment_failed",
    "image_selected",
    "camera_opened",
    "voice_used",
    "report_downloaded",
    "report_shared",
]


class AnalyticsEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: AnalyticsEventName
    session_id: str = Field(min_length=16, max_length=100)
    image_used: Optional[bool] = None
    duration_bucket: Optional[Literal["under_10s", "10_to_30s", "30_to_90s", "over_90s"]] = None
    error_category: Optional[Literal["network", "service", "validation", "unknown"]] = None


class SafetyOverrideOutput(BaseModel):
    override_triggered: bool
    triggered_by: list[str]
    forced_urgency: Optional[str]


class SeverityIndicators(BaseModel):
    open_wound: bool = False
    bleeding: bool = False
    swelling: bool = False
    spreading: bool = False
    discoloration: bool = False
    discharge: bool = False


class VisionOutput(BaseModel):
    medical_relevance: bool = True
    visual_features: dict[str, str] = Field(default_factory=dict)
    severity_indicators: SeverityIndicators = Field(default_factory=SeverityIndicators)
    visual_severity: UrgencyLevel = "low"
    confidence: ConfidenceLevel = "low"
    detected_signs: list[str] = Field(default_factory=list)

    @field_validator("visual_severity", "confidence", mode="before")
    @classmethod
    def lowercase_levels(cls, value):
        return str(value).lower() if value else "low"


class SymptomOutput(BaseModel):
    primary_symptom: str = ""
    body_location: str = ""
    body_region: BodyRegion = "other"
    duration_days: int = 0
    severity_score: int = Field(default=1, ge=1, le=10)
    progression: Literal["improving", "stable", "worsening"] = "stable"
    associated_symptoms: list[str] = Field(default_factory=list)
    patient_reported_severity: UrgencyLevel = "low"
    risk_factors: list[str] = Field(default_factory=list)
    text_completeness: float = Field(default=0.5, ge=0.0, le=1.0)


class ConflictOutput(BaseModel):
    conflict_detected: bool
    conflict_type: Optional[str]
    text_severity: Optional[str]
    vision_severity: Optional[str]
    visual_dominates: bool


class FusionOutput(BaseModel):
    vision_score: float
    text_score: float
    total_risk_score: float
    urgency: UrgencyLevel
    conflict: ConflictOutput
    risk_signals: list[str]
    body_region: str
    no_image_mode: bool


class QualityOutput(BaseModel):
    quality_score: float
    quality_level: UrgencyLevel
    show_uncertain_badge: bool


class DiagnosisOutput(BaseModel):
    possible_conditions: list[str]
    confidence_levels: list[str]
    clinical_reasoning: list[str]
    red_flags: list[str]
    recommendation: str
    disclaimer: str = STANDARD_DISCLAIMER


class PipelineStages(BaseModel):
    safety_override: SafetyOverrideOutput
    vision_output: dict
    symptom_output: SymptomOutput
    fusion_output: FusionOutput
    quality_output: QualityOutput


class FullResponse(BaseModel):
    pipeline_stages: PipelineStages
    diagnosis: DiagnosisOutput
    urgency: UrgencyLevel
    conflict: ConflictOutput
    risk_signals: list[str]
    quality: QualityOutput
    no_image_mode: bool
    no_image_reason: Optional[str] = None
    demo_mode: bool
