"""Client-accepted text, not proof of reading, hearing, or clinical understanding.

Only negotiated new encounters require acknowledgement. Historical attempts and
cached evaluations keep their original evidence/delivery semantics.
"""
from typing import Any


def pending_dialogue(attempt: dict[str, Any]) -> list[str]:
    if attempt.get('dialogueDeliveryVersion') != 1:
        return []
    return [key for key, value in attempt['patientResponses'].items()
            if isinstance(value, dict) and not value.get('deliveryAcknowledgedAt')]
