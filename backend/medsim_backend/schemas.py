from __future__ import annotations

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class PublicPatientProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    displayName: str = Field(min_length=1, max_length=120)
    age: int = Field(ge=0, le=120)
    chiefComplaint: str = Field(min_length=1, max_length=500)


class CreateClinicalAttemptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    caseId: str
    caseVersion: str
    variantSeed: str = Field(default="", max_length=200)
    clientAttemptId: str | None = Field(default=None, min_length=12, max_length=200)
    patientProfile: PublicPatientProfile | None = None
    evidenceVersion: Literal[1, 2] = 1


class InvestigationOrderRequest(BaseModel):
    investigationId: str
    indication: str = ""


class AttemptExaminationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actionId: str = Field(min_length=1, max_length=120)
    performedAt: float


class AttemptDiagnosisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    diagnosisId: str = Field(min_length=1, max_length=120)


class AttemptPrescriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    medicationId: str = Field(min_length=1, max_length=120)
    dose: str = Field(max_length=120)
    duration: str = Field(max_length=120)
    prescribedAt: float


class AttemptCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summaryCompleted: bool = False
    safetyNettingCompleted: bool = False
    ideasConcernsExpectationsCompleted: bool = False


class PatientTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attemptId: str = Field(min_length=20, max_length=100)
    question: str = Field(min_length=1, max_length=500)
    source: Literal["typed", "predefined"]
    questionId: str | None = Field(default=None, max_length=120)
    requestId: str | None = Field(default=None, min_length=12, max_length=100)


class TranscriptEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["trainee", "patient"]
    content: str = Field(max_length=2000)
    timestampIso: str = Field(max_length=80)
    questionSource: Literal["typed", "predefined"] | None = None
    attemptId: str = Field(min_length=20, max_length=100)


class ExaminationEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actionId: str = Field(min_length=1, max_length=120)
    performedAt: float
    attemptId: str = Field(min_length=20, max_length=100)


class PrescriptionEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    medicationId: str = Field(max_length=120)
    dose: str = Field(max_length=120)
    duration: str = Field(max_length=120)


class CompletionEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summaryCompleted: bool = False
    safetyNettingCompleted: bool = False
    ideasConcernsExpectationsCompleted: bool = False


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attemptId: str = Field(min_length=20, max_length=100)
    caseId: str = Field(max_length=120)
    caseVersion: str = Field(max_length=120)
    variantSeed: str = Field(default="", max_length=200)
    askedQuestionIds: list[Annotated[str, Field(min_length=1, max_length=120)]] = Field(default_factory=list, max_length=128)
    treatmentIds: list[Annotated[str, Field(min_length=1, max_length=120)]] = Field(default_factory=list, max_length=128)
    prescriptions: list[PrescriptionEvidence] = Field(default_factory=list, max_length=64)
    submittedDiagnosisId: str | None = Field(default=None, max_length=120)
    transcript: list[TranscriptEvidence] = Field(default_factory=list, max_length=256)
    examinations: list[ExaminationEvidence] = Field(default_factory=list, max_length=64)
    completionChecks: CompletionEvidence | None = None


class PatientTTSRequestBody(BaseModel):
    text: str
    attemptId: str = Field(min_length=20, max_length=100)
    caseId: str
    gender: str = "M"
    isPediatric: bool = False
    speed: Optional[float] = None
    language: str = "en"
    caseVersion: str = Field(default="", max_length=120)
    isOpeningGreeting: bool = False
    cacheable: bool = False
    requestId: str = Field(default="", max_length=100)
