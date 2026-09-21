import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameState } from '../../game/store';
import { CLINIC_LABELS } from '../../game/clinic';

/**
 * Encounter-derived scene state. Room composition deliberately remains in
 * Polyclinic so this hook cannot change geometry, materials, or placement.
 */
export function usePolyclinicEncounterScene() {
  const state = useGameState();
  const clinicId = state.polyclinic.clinic;
  const patient = state.polyclinic.patient;
  const clinicLabel = CLINIC_LABELS[clinicId];
  const [doorOpen, setDoorOpen] = useState(false);
  const previousPatientRef = useRef<typeof patient>(null);

  useEffect(() => {
    const previousPatient = previousPatientRef.current;
    if (patient && !previousPatient) {
      setDoorOpen(true);
      const timeout = window.setTimeout(() => setDoorOpen(false), 5500);
      previousPatientRef.current = patient;
      return () => window.clearTimeout(timeout);
    }
    if (!patient && previousPatient) {
      setDoorOpen(true);
      const timeout = window.setTimeout(() => setDoorOpen(false), 5500);
      previousPatientRef.current = null;
      return () => window.clearTimeout(timeout);
    }
    previousPatientRef.current = patient;
  }, [patient]);

  const patientKey = useMemo(() => {
    if (!patient) return null;
    return `${patient.case.id}-${patient.arrivedAt}`;
  }, [patient]);

  return { clinicLabel, doorOpen, patient, patientKey };
}
