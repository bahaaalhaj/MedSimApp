import { useSyncExternalStore } from 'react';
import type {
  ActivePatient,
  AvatarStyle,
  EndConfirmChecks,
  GameState,
  PatientCase,
  RoomLayout,
  Screen,
  Tweaks,
} from './types';
import type { ClinicId } from './clinic';
import { DEFAULT_CLINIC } from './clinic';
import type { PaletteName } from '../styles/palettes';
import type { Case as MedKitCase } from '../data/cases';
import { CASES, getCase, getCaseClinic, getPatientCase } from '../data/cases';

const ONBOARDED_KEY = 'medkit:onboarded';
const LOCAL_PROFILE_KEY = 'medsim:local-profile';

function readLocalLearnerName(): string | null {
  try {
    const value = window.localStorage.getItem(LOCAL_PROFILE_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

/** Sentinel used as `bedIndex` for polyclinic patients across the store and
 * the 3D scene. Preserved for saved encounter compatibility. */
export const POLYCLINIC_BED_INDEX = -10;

function readOnboarded(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOnboarded(v: boolean) {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, v ? '1' : '0');
  } catch {
    /* private mode — non-fatal */
  }
}

const DEFAULT_TWEAKS: Tweaks = {
  palette: 'sunshine',
  avatarStyle: 'portrait',
  intensity: 2,
  roomLayout: 'side',
};

/** Resolve the full medkit `PatientCase` (anamnesis, vitals, diagnosis
 *  options, etc.) for a cozy-cartoon `Case`. If we can't find one in the
 *  catalogue (shouldn't happen — the cartoon library is derived FROM the
 *  catalogue), fall back to a minimal stub built from the cartoon shape so
 *  the voice agent + 3D scene still get something to render. */
function toPatientCase(c: MedKitCase): PatientCase {
  const real = getPatientCase(c.id);
  if (real) return real;
  const isRedFlag = c.tags.some((t) => t.toLowerCase().includes('red flag'));
  return {
    id: c.id,
    name: c.name,
    age: c.age,
    gender: c.sex,
    severity: isRedFlag ? 'urgent' : 'stable',
    arrivalBlurb: c.complaint,
    chiefComplaint: c.complaint,
    vitals: { hr: 88, bp: '162/96', spo2: 98, temp: 36.7, rr: 16 },
    anamnesis: [],
    testResults: [],
    correctDiagnosisId: '',
    acceptableTreatmentIds: [],
    criticalTreatmentIds: [],
    diagnosisOptions: [],
  };
}

/** True when the trainee actually engaged with the patient — asked a
 *  history question, ordered a test, gave a treatment, prescribed, or
 *  submitted a diagnosis. A freshly-arrived patient with no interaction
 *  yet returns false. Used to guard `lastEncounter` overwrites. */
function hasEncounterActivity(p: ActivePatient): boolean {
  return (
    p.askedQuestionIds.length > 0 ||
    p.orderedTestIds.length > 0 ||
    p.givenTreatmentIds.length > 0 ||
    (p.prescriptions?.length ?? 0) > 0 ||
    p.submittedDiagnosisId !== null
  );
}

function toActivePatient(c: MedKitCase): ActivePatient {
  const now = Date.now();
  return {
    case: toPatientCase(c),
    bedIndex: POLYCLINIC_BED_INDEX,
    status: 'in-bed',
    askedQuestionIds: [],
    orderedTestIds: [],
    testOrderedAt: {},
    completedTestIds: [],
    givenTreatmentIds: [],
    submittedDiagnosisId: null,
    arrivedAt: now,
    deadlineMs: now + 8 * 60 * 1000,
  };
}

class Store {
  private state: GameState = {
    screen: 'splash',
    tweaks: { ...DEFAULT_TWEAKS },
    onboardingStep: 0,
    endConfirm: { sum: false, safe: false, ice: false },
    selectedCaseId: 'im-001',
    hasOnboarded: readOnboarded(),
    learnerName: readLocalLearnerName(),
    polyclinic: { clinic: DEFAULT_CLINIC, patient: null },
    lastEncounter: null,
    viewedEvalHistoryId: null,
  };

  private listeners = new Set<() => void>();

  getState = (): GameState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(next: Partial<GameState>) {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }

  // ── navigation ────────────────────────────────
  setScreen = (screen: Screen) => this.set({ screen });

  /** Open the debrief screen in review mode for a saved evaluation. */
  viewEvalHistory = (historyId: string) =>
    this.set({ viewedEvalHistoryId: historyId, screen: 'debrief' });

  clearViewedEval = () => this.set({ viewedEvalHistoryId: null });

  /** The welcome action always introduces the identity boundary first. */
  beginFromSplash = () => {
    this.set({ screen: 'login' });
  };

  /** Temporary device-local profile. It is deliberately labelled as such in
   * the UI and must be replaced by server authentication before deployment. */
  continueWithLocalProfile = (name: string) => {
    const learnerName = name.trim().slice(0, 80);
    if (!learnerName) return;
    try {
      window.localStorage.setItem(LOCAL_PROFILE_KEY, learnerName);
    } catch {
      /* Storage may be unavailable; the in-memory profile still works. */
    }
    this.set({
      learnerName,
      screen: this.state.hasOnboarded ? 'home' : 'onboarding',
    });
  };

  // ── onboarding ────────────────────────────────
  setOnboardingStep = (step: number) =>
    this.set({ onboardingStep: Math.max(0, Math.min(2, step)) });

  finishOnboarding = () => {
    writeOnboarded(true);
    this.set({ hasOnboarded: true, screen: 'home', onboardingStep: 0 });
  };

  // ── tweaks ────────────────────────────────────
  setPalette = (palette: PaletteName) =>
    this.set({ tweaks: { ...this.state.tweaks, palette } });
  setAvatarStyle = (avatarStyle: AvatarStyle) =>
    this.set({ tweaks: { ...this.state.tweaks, avatarStyle } });
  setIntensity = (intensity: number) =>
    this.set({ tweaks: { ...this.state.tweaks, intensity } });
  setRoomLayout = (roomLayout: RoomLayout) =>
    this.set({ tweaks: { ...this.state.tweaks, roomLayout } });

  // ── polyclinic ────────────────────────────────
  setPolyclinicClinic = (clinic: ClinicId) =>
    this.set({ polyclinic: { ...this.state.polyclinic, clinic } });

  /** Track which patients have been finished this session so the
   *  "next patient" picker doesn't loop on the same chart. Cleared on
   *  page reload — that's intentional, this is a training session, not
   *  a database. */
  private attemptedCaseIds = new Set<string>();

  /** Find the next case in the active clinic that hasn't been attempted
   *  yet. Falls back to the first case in the clinic, then to any case if
   *  the clinic has no cases at all. Returns null only if the catalogue
   *  is somehow empty. */
  pickNextCaseId = (): string | null => {
    const clinic = this.state.polyclinic.clinic;
    const inClinic = (
      clinic === 'all-specialties'
        ? CASES
        : CASES.filter((c) => c.clinic === clinic)
    );
    const fresh = inClinic.find((c) => !this.attemptedCaseIds.has(c.id));
    if (fresh) return fresh.id;
    if (inClinic.length > 0) return inClinic[0].id;
    return CASES[0]?.id ?? null;
  };

  /** Mark a case as attempted so the next-patient picker skips it. */
  private markAttempted(id: string) {
    this.attemptedCaseIds.add(id);
  }

  /** Drop the patient into the polyclinic 3D scene — they walk in, sit on the
   *  chair, ready for the text-first consultation workflow. */
  loadPolyclinicPatient = (id: string) => {
    const c = getCase(id);
    this.set({
      selectedCaseId: id,
      polyclinic: { ...this.state.polyclinic, patient: toActivePatient(c) },
    });
  };

  /** Clear the patient — triggers the walk-out animation in the 3D scene.
   *  Snapshots the encounter into `lastEncounter` so DebriefScreen can grade
   *  it after the patient has left the chair.
   *
   *  Only overwrites `lastEncounter` if the snapshot has actual encounter
   *  activity. Otherwise the previous snapshot is preserved. This matters
   *  because the Dispatch flow auto-loads the next patient — if the trainee
   *  then clicks "End consultation" before engaging that fresh patient,
   *  the empty new-patient snapshot would otherwise clobber the real one
   *  and the debrief request would arrive with empty arrays. */
  finishPolyclinicCase = () => {
    const snapshot = this.state.polyclinic.patient;
    const keepSnapshot = snapshot && hasEncounterActivity(snapshot);
    this.set({
      polyclinic: { ...this.state.polyclinic, patient: null },
      lastEncounter: keepSnapshot ? snapshot : this.state.lastEncounter,
    });
  };

  // ── per-screen state ──────────────────────────
  toggleEndConfirm = (key: keyof EndConfirmChecks) =>
    this.set({
      endConfirm: { ...this.state.endConfirm, [key]: !this.state.endConfirm[key] },
    });

  /** Library card click: pin the polyclinic to the case's specialty so the
   *  next-patient flow walks the same roster, then jump to the brief. */
  selectCase = (id: string) => {
    const clinic = getCaseClinic(id);
    this.set({
      selectedCaseId: id,
      screen: 'brief',
      polyclinic: clinic
        ? { ...this.state.polyclinic, clinic }
        : this.state.polyclinic,
    });
  };

  /** "Accept the next patient" — drop straight into the 3D encounter.
   *
   *  When called without an explicit id, picks the next unattempted case
   *  from the active polyclinic so the doctor can hammer through e.g.
   *  pediatrics one at a time without going back to the library.
   *
   */
  acceptNextPatient = (id?: string) => {
    const targetId = id ?? this.pickNextCaseId() ?? this.state.selectedCaseId;
    const c = getCase(targetId);
    const clinic = getCaseClinic(targetId);
    this.markAttempted(targetId);
    this.set({
      selectedCaseId: targetId,
      polyclinic: {
        ...this.state.polyclinic,
        clinic: clinic ?? this.state.polyclinic.clinic,
        patient: toActivePatient(c),
      },
      screen: 'encounter',
    });
  };

  // ── examine flow ───────────────────────────────
  /** Mutate the seated polyclinic patient. No-op when the bed is empty.
   *  The mutator builds the next snapshot from the current one. */
  private updatePolyclinicPatient = (mut: (p: ActivePatient) => ActivePatient) => {
    const cur = this.state.polyclinic.patient;
    if (!cur) return;
    this.set({ polyclinic: { ...this.state.polyclinic, patient: mut(cur) } });
  };

  /** History tab: mark a question as asked so the answer becomes visible. */
  askPolyclinicQuestion = (qid: string) =>
    this.updatePolyclinicPatient((p) => {
      if (p.askedQuestionIds.includes(qid)) return p;
      return { ...p, askedQuestionIds: [...p.askedQuestionIds, qid] };
    });

  /** Order Tests tab: in the polyclinic the result is instant, so we set
   *  both `orderedTestIds` and `completedTestIds` in one shot. */
  orderPolyclinicTest = (testId: string) =>
    this.updatePolyclinicPatient((p) => {
      if (p.orderedTestIds.includes(testId)) return p;
      const now = Date.now();
      return {
        ...p,
        orderedTestIds: [...p.orderedTestIds, testId],
        testOrderedAt: { ...p.testOrderedAt, [testId]: now },
        completedTestIds: [...p.completedTestIds, testId],
      };
    });

  /** Diagnose tab: lock in a diagnosis. Once submitted, options become
   *  disabled and the prescription tab unlocks. */
  submitPolyclinicDiagnosis = (dxId: string) =>
    this.updatePolyclinicPatient((p) =>
      p.submittedDiagnosisId ? p : { ...p, submittedDiagnosisId: dxId },
    );

  /** Rx tab: append a prescription line to the patient's record. */
  addPolyclinicPrescription = (rx: { medicationId: string; dose: string; duration: string }) =>
    this.updatePolyclinicPatient((p) => ({
      ...p,
      prescriptions: [
        ...(p.prescriptions ?? []),
        { ...rx, prescribedAt: Date.now() },
      ],
    }));
}

export const store = new Store();

if (
  typeof window !== 'undefined' &&
  (import.meta.env.DEV ||
    ['localhost', '127.0.0.1'].includes(window.location.hostname))
) {
  (window as unknown as { __store: Store }).__store = store;
}

// ── React bindings (useSyncExternalStore) ────────────────────────

export function useStore<T>(selector: (s: GameState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export function useScreen(): Screen {
  return useStore((s) => s.screen);
}

export function useTweaks(): Tweaks {
  return useStore((s) => s.tweaks);
}

/** Full snapshot — used by the 3D Polyclinic component (which reads
 *  `state.polyclinic.{clinic, patient}`). */
export function useGameState(): GameState {
  return useStore((s) => s);
}
