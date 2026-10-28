import { useSyncExternalStore } from 'react';
import type {
  ActivePatient,
  AvatarStyle,
  EndConfirmChecks,
  GameState,
  LearnerPatientCase,
  RoomLayout,
  Screen,
  Tweaks,
} from './types';
import type { ClinicId } from './clinic';
import { DEFAULT_CLINIC } from './clinic';
import type { PaletteName } from '../styles/palettes';
import type { Case as MedSimCase } from '../data/cases';
import { getAssignableCases, getCase, getCaseClinic, getCaseVersion, getPatientCase, getRubricVersion } from '../data/cases';
import { clearAllConversationStorage, clearAllPatientConversations, ensureAudioContext } from '../voice/conversationStore';
import { hasEncounterActivity } from './encounterState';
import { PilotHistory, type PilotRoute } from './pilotNavigation';
import { recoverAttempt, restorePatient } from './attemptRecovery';
import type { EncounterTranscriptEntry } from './types';
import type { TrainingMode } from '../clinical/types';
import { completeEncounter, encounterKey, isSameEncounter } from './encounterState';
import { appendTranscript, bindEvidenceToAttempt } from './transcriptState';
import { navigationUpdate } from './navigationState';
import { appendInvestigationError, markInvestigationAttemptError, markInvestigationAttemptReady, markTestOrdered, replaceInvestigationOrder } from './investigationState';
import {
  createInvestigationAttempt,
  getInvestigationResult,
  orderInvestigation,
  recordCompletion,
  recordExamination,
  recordPrescription,
  submitDiagnosis,
} from '../clinical/investigationApi';

const ONBOARDED_KEY = 'medsim:onboarded';

/** Sentinel used as `bedIndex` for polyclinic patients across the store,
 *  the conversation cache, and the 3D scene. `voice/conversationStore.ts`
 *  keys on this. */
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

/** Resolve the full medsim `PatientCase` (anamnesis, vitals, diagnosis
 *  options, etc.) for a cozy-cartoon `Case`. If we can't find one in the
 *  catalogue (shouldn't happen — the cartoon library is derived FROM the
 *  catalogue), fall back to a minimal stub built from the cartoon shape so
 *  the voice agent + 3D scene still get something to render. */
function seeded(seedText: string): () => number {
  let seed = 2166136261 >>> 0;
  for (let index = 0; index < seedText.length; index++) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function toPatientCase(c: MedSimCase, variantSeed: string): LearnerPatientCase {
  const real = getPatientCase(c.id);
  if (real) {
    const policy = real.variantPolicy;
    if (!policy) return real;
    const random = seeded(`${c.id}:${getCaseVersion(c.id)}:${variantSeed}`);
    const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];
    const name = pick(policy.allowedDisplayNames);
    const age = policy.ageRange.min + Math.floor(random() * (policy.ageRange.max - policy.ageRange.min + 1));
    const chiefComplaint = pick(policy.allowedComplaintPhrasings);
    if (policy.difficultyOptions?.length) pick(policy.difficultyOptions);
    return { ...real, name, age, chiefComplaint };
  }
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
    diagnosisOptions: [],
    diagnosisLabels: {},
  };
}

function toActivePatient(c: MedSimCase, variantSeed = `${Date.now()}-${c.id}`): ActivePatient {
  const now = Date.now();
  return {
    case: toPatientCase(c, variantSeed),
    bedIndex: POLYCLINIC_BED_INDEX,
    status: 'in-bed',
    askedQuestionIds: [],
    transcript: [],
    examinationActions: [],
    encounterAttemptId: `${c.id}-${now}-${Math.random().toString(36).slice(2, 10)}`,
    orderedTestIds: [],
    testOrderedAt: {},
    completedTestIds: [],
    investigationAttemptId: null,
    investigationAttemptStatus: 'initializing',
    investigationCatalogue: [],
    investigationOrders: [],
    givenTreatmentIds: [],
    submittedDiagnosisId: null,
    arrivedAt: now,
    consultationStartedAt: now,
    consultationFinishedAt: null,
    caseVersion: getCaseVersion(c.id),
    rubricVersion: getRubricVersion(c.id),
    variantSeed,
  };
}

class Store {
  private history: PilotHistory | null = null;
  private owner: string | null = null;
  private applyingRoute = false;
  private replacingNavigation = false;
  private recoveryController: AbortController | null = null;
  private checkpointKey() { return `medsim:recovery:${this.owner}`; }
  private currentRoute(): PilotRoute {
    const patient = this.state.polyclinic.patient ?? this.state.lastEncounter;
    return { screen: this.state.screen, caseId: this.state.selectedCaseId,
      attemptId: patient?.investigationAttemptId ?? undefined,
      reviewId: this.state.viewedEvalHistoryId ?? undefined, examine: this.state.examineOpen || undefined,
      onboardingStep: this.state.screen === 'onboarding' ? this.state.onboardingStep : undefined };
  }
  private allowNavigation = (route: PilotRoute) => {
    const patient = this.state.polyclinic.patient;
    return !patient || !hasEncounterActivity(patient) || !['encounter', 'endConfirm'].includes(this.state.screen)
      || ['encounter', 'endConfirm', 'debrief'].includes(route.screen)
      || window.confirm('Pause this unfinished encounter and leave the room? You can resume it during this server session. Unsynced actions may be lost on refresh.');
  };
  startNavigation = (owner: string | null) => {
    if (this.owner === owner && this.history) return;
    this.history?.dispose();
    this.recoveryController?.abort();
    if (this.owner && this.owner !== owner) this.resetForIdentityExit();
    this.owner = owner;
    this.history = new PilotHistory(window, (route) => { void this.applyRoute(route); }, this.allowNavigation);
    this.applyingRoute = true;
    try { this.set({ recoverableEncounter: Boolean(owner && sessionStorage.getItem(this.checkpointKey())) }); } catch { /* unavailable storage */ }
    void this.applyRoute(this.history.current());
  };
  stopNavigation = () => {
    this.recoveryController?.abort();
    this.history?.dispose();
    this.history = null;
  };
  resumeEncounter = () => {
    try {
      const route = JSON.parse(sessionStorage.getItem(this.checkpointKey()) ?? 'null') as PilotRoute | null;
      if (route?.attemptId) { this.history?.write(route); void this.applyRoute(route); }
    } catch { this.set({ navigationNotice: 'Recovery storage is unavailable. Open saved history or choose a new case.' }); }
  };
  retryRecovery = () => { if (this.history) void this.applyRoute(this.history.current()); };
  dismissRecovery = () => {
    this.recoveryController?.abort();
    this.set({ recoveryStatus: 'ready', navigationNotice: undefined });
    this.setScreen('gpRoom');
  };
  private async applyRoute(route: PilotRoute) {
    this.recoveryController?.abort();
    const controller = new AbortController();
    this.recoveryController = controller;
    this.applyingRoute = true;
    try {
      if (!this.owner && !['splash', 'onboarding', 'auth'].includes(route.screen)) {
        this.set({ screen: 'auth', recoveryStatus: 'ready', navigationNotice: 'Sign in or choose guest mode before opening a training page.' });
        this.history?.write(this.currentRoute(), true);
        return;
      }
      const requested = ['encounter', 'endConfirm', 'debrief'].includes(route.screen) && !route.reviewId;
      let screen = route.screen === 'auth' && this.owner ? 'gpRoom' : route.screen;
      if (requested) {
        const reference = route.attemptId;
        const existing = this.state.polyclinic.patient ?? this.state.lastEncounter;
        if (!reference && !existing) throw new Error('No encounter is attached to this page. Use Resume encounter, saved history, or choose a new case.');
        if (reference && (existing?.investigationAttemptId !== reference || route.screen !== this.state.screen)) {
          this.set({ recoveryStatus: 'loading', navigationNotice: undefined });
          const view = await recoverAttempt(reference, controller.signal);
          if (controller.signal.aborted) return;
          if (!getAssignableCases(this.state.trainingMode).some((item) => item.id === view.caseId)) throw new Error('This case is no longer assignable. Open saved history or choose a new case.');
          const base = toActivePatient(getCase(view.caseId), view.variantSeed);
          const patient = restorePatient(view, base, base.case);
          const finished = view.evaluationActive || view.evaluationResult || route.screen === 'debrief'
            || (!this.state.polyclinic.patient && existing?.investigationAttemptId === reference);
          if (finished && screen !== 'debrief') {
            screen = 'debrief';
            this.set({ navigationNotice: 'This consultation is finished. Review the debrief or choose a new case.' });
          }
          this.set({ selectedCaseId: view.caseId,
            polyclinic: { ...this.state.polyclinic, patient: finished ? null : patient },
            lastEncounter: finished ? patient : null, endConfirm: patient.encounterChecks ?? { sum: false, safe: false, ice: false } });
        } else if (!this.state.polyclinic.patient && screen !== 'debrief') {
          screen = 'debrief';
          this.set({ navigationNotice: 'This consultation is finished. Its debrief is available; start a new case to practise again.' });
        }
      }
      this.set({ screen, selectedCaseId: route.caseId && getAssignableCases(this.state.trainingMode).some((item) => item.id === route.caseId) ? route.caseId : this.state.selectedCaseId,
        viewedEvalHistoryId: route.reviewId ?? null, examineOpen: screen === 'encounter' && Boolean(route.examine), recoveryStatus: 'ready',
        onboardingStep: route.onboardingStep ?? this.state.onboardingStep });
      this.history?.write(this.currentRoute(), true);
    } catch (error) {
      if (!controller.signal.aborted) this.set({ recoveryStatus: 'error', navigationNotice: error instanceof Error ? error.message : 'Recovery is unavailable. Your saved history is separate.' });
    } finally {
      if (this.recoveryController === controller) this.applyingRoute = false;
    }
  }
  private state: GameState = {
    screen: 'splash',
    tweaks: { ...DEFAULT_TWEAKS },
    onboardingStep: 0,
    endConfirm: { sum: false, safe: false, ice: false },
    selectedCaseId: 'im-001',
    trainingMode: 'curated',
    hasOnboarded: readOnboarded(),
    polyclinic: { clinic: DEFAULT_CLINIC, patient: null },
    lastEncounter: null,
    viewedEvalHistoryId: null,
  };

  private listeners = new Set<() => void>();
  private investigationInitPromise: Promise<string | null> | null = null;
  private investigationInitEncounterKey: string | null = null;

  getState = (): GameState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(next: Partial<GameState>) {
    if (next.screen === 'auth' && this.owner) next = { ...next, screen: 'gpRoom' };
    if (!this.applyingRoute && next.screen && next.screen !== this.state.screen && !this.allowNavigation({ screen: next.screen })) return;
    if (next.screen && next.screen !== 'encounter') next = { ...next, examineOpen: false };
    if (next.screen && next.screen !== 'debrief') next = { ...next, viewedEvalHistoryId: null };
    this.state = { ...this.state, ...next };
    if (this.owner) {
      const patient = this.state.polyclinic.patient ?? this.state.lastEncounter;
      if (patient?.investigationAttemptId) {
        try { sessionStorage.setItem(this.checkpointKey(), JSON.stringify({ screen: this.state.polyclinic.patient ? 'encounter' : 'debrief',
          caseId: patient.case.id, attemptId: patient.investigationAttemptId })); } catch { /* recovery is optional in private storage mode */ }
        this.state = { ...this.state, recoverableEncounter: true };
      }
    }
    if (!this.applyingRoute) this.history?.write(this.currentRoute(), this.replacingNavigation);
    for (const l of this.listeners) l();
  }

  // ── navigation ────────────────────────────────
  setScreen = (screen: Screen) => {
    if (['encounter', 'endConfirm'].includes(screen) && !this.state.polyclinic.patient) {
      if (this.state.lastEncounter) this.set({ screen: 'debrief', navigationNotice: 'This consultation is finished. Review the debrief or choose a new case.' });
      else this.set({ screen, recoveryStatus: 'error', navigationNotice: 'No encounter is attached to this page. Use Resume encounter, saved history, or choose a new case.' });
      return;
    }
    this.set(navigationUpdate(screen));
  };
  backTo = (screen: Screen) => {
    if (this.history?.backTo(screen)) return;
    this.replacingNavigation = true;
    try { this.setScreen(screen); } finally { this.replacingNavigation = false; }
  };
  backOnboarding = () => {
    if (!this.history?.backTo('onboarding')) this.setOnboardingStep(this.state.onboardingStep - 1);
  };
  setExamineOpen = (examineOpen: boolean) => {
    if (!examineOpen && this.state.examineOpen && this.history?.backTo('encounter')) return;
    this.replacingNavigation = !examineOpen;
    try { this.set({ examineOpen }); } finally { this.replacingNavigation = false; }
  };

  /** Open the debrief screen in review mode for a saved evaluation. */
  viewEvalHistory = (historyId: string) =>
    this.set({ viewedEvalHistoryId: historyId, screen: 'debrief' });

  clearViewedEval = () => this.set({ viewedEvalHistoryId: null });

  /** Splash → onboarding (first run) or polyclinic (returning). */
  beginFromSplash = () => {
    this.set({ screen: this.state.hasOnboarded ? 'auth' : 'onboarding' });
  };

  // ── onboarding ────────────────────────────────
  setOnboardingStep = (step: number) =>
    this.set({ onboardingStep: Math.max(0, Math.min(2, step)) });

  finishOnboarding = () => {
    writeOnboarded(true);
    this.set({ hasOnboarded: true, screen: 'auth', onboardingStep: 0 });
  };

  resetForIdentityExit = () => {
    this.stopNavigation();
    if (this.owner) { try { sessionStorage.removeItem(this.checkpointKey()); } catch { /* unavailable storage */ } }
    this.owner = null;
    clearAllPatientConversations();
    clearAllConversationStorage();
    this.attemptedCaseIds.clear();
    this.applyingRoute = true;
    this.set({
      screen: 'auth',
      polyclinic: { ...this.state.polyclinic, patient: null },
      lastEncounter: null,
      viewedEvalHistoryId: null,
      endConfirm: { sum: false, safe: false, ice: false },
      recoveryStatus: 'ready', navigationNotice: undefined, recoverableEncounter: false,
    });
    this.applyingRoute = false;
    if (typeof window !== 'undefined') window.history.replaceState(null, '', '#/auth');
  };

  // ── tweaks ────────────────────────────────────
  clearExpiredIdentity = () => { if (this.owner) this.resetForIdentityExit(); };

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

  setTrainingMode = (_trainingMode: TrainingMode) => {
    this.attemptedCaseIds.clear();
    this.set({ trainingMode: 'curated', polyclinic: { ...this.state.polyclinic, patient: null } });
  };

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
    const assignable = getAssignableCases(this.state.trainingMode);
    const inClinic = (
      clinic === 'all-specialties'
        ? assignable
        : assignable.filter((c) => c.clinic === clinic)
    );
    const fresh = inClinic.filter((c) => !this.attemptedCaseIds.has(c.id));
    const pool = fresh.length > 0 ? fresh : inClinic;
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)].id;
  };

  /** Mark a case as attempted so the next-patient picker skips it. */
  private markAttempted(id: string) {
    this.attemptedCaseIds.add(id);
  }

  /** Drop the patient into the polyclinic 3D scene and initialize the encounter. */
  loadPolyclinicPatient = (id: string) => {
    if (this.state.polyclinic.patient && hasEncounterActivity(this.state.polyclinic.patient)
      && !window.confirm('Replace the unfinished encounter with this patient? The previous encounter will no longer be offered for recovery.')) return false;
    const c = getCase(id);
    if (!getAssignableCases(this.state.trainingMode).some((x) => x.id === id)) {
      throw new Error(`Case ${id} is not assignable in ${this.state.trainingMode} mode`);
    }
    this.set({
      selectedCaseId: id,
      polyclinic: { ...this.state.polyclinic, patient: toActivePatient(c) },
    });
    void this.initializeInvestigationAttempt();
    return true;
  };

  /** Start the count-up on the explicit entry gesture; returning does not reset it. */
  beginPolyclinicConsultation = () => {
    try { ensureAudioContext(); } catch { /* text remains available */ }
    const current = this.state.polyclinic.patient;
    if (!current || current.case.id !== this.state.selectedCaseId) {
      if (!this.loadPolyclinicPatient(this.state.selectedCaseId)) return;
    }
    this.set({ screen: 'encounter' });
  };

  /** Clear the patient — triggers the walk-out animation in the 3D scene.
   *  Snapshots the encounter into `lastEncounter` so DebriefScreen can grade
   *  it after the patient has left the chair.
   *
   *  Only overwrites `lastEncounter` if the snapshot has actual encounter
   *  activity. Otherwise the previous snapshot is preserved. */
  finishPolyclinicCase = (navigateToDebrief = false): boolean => {
    const current = this.state.polyclinic.patient;
    if (!current) return false;
    const snapshot = completeEncounter(current, this.state.endConfirm, this.state.lastEncounter);
    const keepSnapshot = snapshot !== this.state.lastEncounter;
    this.set({
      polyclinic: { ...this.state.polyclinic, patient: null },
      lastEncounter: snapshot,
      ...(navigateToDebrief ? { screen: 'debrief' as const } : {}),
    });
    return Boolean(keepSnapshot);
  };

  // ── per-screen state ──────────────────────────
  toggleEndConfirm = (key: keyof EndConfirmChecks) => {
    const endConfirm = { ...this.state.endConfirm, [key]: !this.state.endConfirm[key] };
    this.set({ endConfirm });
    const attemptId = this.state.polyclinic.patient?.investigationAttemptId;
    if (attemptId) void recordCompletion(attemptId, {
      summaryCompleted: endConfirm.sum,
      safetyNettingCompleted: endConfirm.safe,
      ideasConcernsExpectationsCompleted: endConfirm.ice,
    }).catch(() => undefined);
  };

  /** Library card click: pin the polyclinic to the case's specialty so the
   *  next-patient flow walks the same roster, then jump to the brief. */
  selectCase = (id: string) => {
    if (!getAssignableCases(this.state.trainingMode).some((c) => c.id === id)) return;
    const clinic = getCaseClinic(id);
    this.set({
      selectedCaseId: id,
      screen: 'brief',
      polyclinic: clinic
        ? { ...this.state.polyclinic, clinic }
        : this.state.polyclinic,
    });
  };

  /** "Accept the next patient" — drop straight into the 3D encounter with
   *  the patient seated and the voice agent already connecting.
   *
   *  When called without an explicit id, picks the next unattempted case
   *  from the active polyclinic so the doctor can hammer through e.g.
   *  pediatrics one at a time without going back to the library.
   *
   *  Patient speech is unlocked by the same explicit acceptance gesture. */
  acceptNextPatient = (id?: string) => {
    if (this.state.polyclinic.patient && hasEncounterActivity(this.state.polyclinic.patient)
      && !window.confirm('Replace the unfinished encounter with a new patient? The current encounter will no longer be offered for recovery.')) return;
    const targetId = id ?? this.pickNextCaseId();
    if (!targetId || !getAssignableCases(this.state.trainingMode).some((c) => c.id === targetId)) return;
    const c = getCase(targetId);
    const clinic = getCaseClinic(targetId);
    try { ensureAudioContext(); } catch { /* text conversation remains available */ }
    this.markAttempted(targetId);
    this.set({
      selectedCaseId: targetId,
      polyclinic: {
        ...this.state.polyclinic,
        clinic: clinic ?? this.state.polyclinic.clinic,
        patient: toActivePatient(c),
      },
      endConfirm: { sum: false, safe: false, ice: false },
      screen: 'encounter',
    });
    void this.initializeInvestigationAttempt();
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

  authorizePolyclinicAnswer = (qid: string, answer: string, relevant: boolean) =>
    this.updatePolyclinicPatient((p) => ({
      ...p,
      askedQuestionIds: p.askedQuestionIds.includes(qid) ? p.askedQuestionIds : [...p.askedQuestionIds, qid],
      case: {
        ...p.case,
        anamnesis: p.case.anamnesis.map((item) => item.id === qid ? { ...item, answer, relevant } : item),
      },
    }));

  appendTranscriptEntry = (entry: EncounterTranscriptEntry) =>
    this.updatePolyclinicPatient((p) => appendTranscript(p, entry));

  recordExaminationAction = (actionId: string) => {
    const patient = this.state.polyclinic.patient;
    if (!patient || patient.examinationActions.some((item) => item.actionId === actionId)) return;
    const performedAt = Date.now();
    this.updatePolyclinicPatient((p) => ({ ...p, examinationActions: [...p.examinationActions, {
      actionId, performedAt, attemptId: p.investigationAttemptId ?? p.encounterAttemptId,
    }] }));
    void (async () => {
      const attemptId = patient.investigationAttemptId ?? await this.initializeInvestigationAttempt();
      if (attemptId) await recordExamination(attemptId, actionId, performedAt);
    })().catch(() => undefined);
  };

  initializeInvestigationAttempt = async () => {
    const patient = this.state.polyclinic.patient;
    if (!patient) return null;
    if (patient.investigationAttemptId) return patient.investigationAttemptId;
    const targetEncounterKey = encounterKey(patient);
    if (this.investigationInitPromise && this.investigationInitEncounterKey === targetEncounterKey) return this.investigationInitPromise;
    let task: Promise<string | null> | null = null;
    task = (async () => {
      try {
        const attempt = await createInvestigationAttempt(
          patient.case.id,
          patient.caseVersion,
          patient.variantSeed,
          patient.encounterAttemptId,
          { displayName: patient.case.name, age: patient.case.age, chiefComplaint: patient.case.chiefComplaint },
        );
        this.updatePolyclinicPatient((current) => !isSameEncounter(current, patient)
          ? current
          : bindEvidenceToAttempt(markInvestigationAttemptReady(current, attempt), attempt.attemptId));
        return attempt.attemptId;
      } catch {
        this.updatePolyclinicPatient((current) => isSameEncounter(current, patient)
          ? markInvestigationAttemptError(current)
          : current);
        return null;
      } finally {
        // Do not clear a newer patient's in-flight initialization when a
        // previous request resolves after the patient changed.
        if (this.investigationInitPromise === task) {
          this.investigationInitPromise = null;
          this.investigationInitEncounterKey = null;
        }
      }
    })();
    this.investigationInitPromise = task;
    this.investigationInitEncounterKey = targetEncounterKey;
    return task;
  };

  /** Order an individual case-available investigation through the server.
   * The server owns and returns the immutable result snapshot. */
  refreshInvestigationResults = async (signal: AbortSignal) => {
    const patient = this.state.polyclinic.patient;
    if (!patient?.investigationAttemptId) return;
    await Promise.all(patient.investigationOrders.filter((order) => !order.resultSnapshot && ['available', 'pending'].includes(order.status)).map(async (order) => {
      try {
        const wait = Math.max(0, order.availableAt * 1000 - Date.now()) + 40;
        await new Promise<void>((resolve, reject) => {
          const aborted = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, wait);
          if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true });
        });
        const resolved = await getInvestigationResult(patient.investigationAttemptId!, order.orderId, signal);
        if (!signal.aborted) this.updatePolyclinicPatient((current) => isSameEncounter(current, patient) ? replaceInvestigationOrder(current, order.investigationId, resolved) : current);
      } catch {
        if (!signal.aborted) this.set({ navigationNotice: 'A saved investigation result could not be retrieved. Reopen this encounter to retry; no order was repeated.' });
      }
    }));
  };

  orderPolyclinicTest = async (testId: string, indication = '') => {
    let patient = this.state.polyclinic.patient;
    if (!patient || patient.orderedTestIds.includes(testId)) return;
    const requestedFor = patient;
    if (!patient.investigationAttemptId) {
      await this.initializeInvestigationAttempt();
      patient = this.state.polyclinic.patient;
    }
    if (!patient?.investigationAttemptId || !isSameEncounter(patient, requestedFor)) return;
    const now = Date.now();
    this.updatePolyclinicPatient((p) => isSameEncounter(p, patient) ? markTestOrdered(p, testId, now) : p);
    try {
      const ordered = await orderInvestigation(patient.investigationAttemptId, testId, indication);
      this.updatePolyclinicPatient((p) => isSameEncounter(p, patient) ? replaceInvestigationOrder(p, testId, ordered) : p);
      const delay = Math.max(0, ordered.availableAt * 1000 - Date.now()) + 40;
      await new Promise((resolve) => setTimeout(resolve, delay));
      const resolved = await getInvestigationResult(patient.investigationAttemptId, ordered.orderId);
      this.updatePolyclinicPatient((p) => isSameEncounter(p, patient) ? replaceInvestigationOrder(p, testId, resolved) : p);
    } catch {
      this.updatePolyclinicPatient((p) => isSameEncounter(p, patient) ? appendInvestigationError(p, testId, indication, now) : p);
    }
  };

  /** Diagnose tab: lock in a diagnosis. Once submitted, options become
   *  disabled and the prescription tab unlocks. */
  submitPolyclinicDiagnosis = (dxId: string) => {
    const patient = this.state.polyclinic.patient;
    if (!patient || patient.submittedDiagnosisId) return;
    this.updatePolyclinicPatient((p) => ({ ...p, submittedDiagnosisId: dxId }));
    void (async () => {
      const attemptId = patient.investigationAttemptId ?? await this.initializeInvestigationAttempt();
      if (!attemptId) return;
      const result = await submitDiagnosis(attemptId, dxId);
      this.updatePolyclinicPatient((p) => !isSameEncounter(p, patient) || p.submittedDiagnosisId !== dxId ? p : {
        ...p,
        diagnosisResult: { correctDiagnosisId: result.correctDiagnosisId, diagnosisWasCorrect: result.diagnosisWasCorrect },
      });
    })().catch(() => undefined);
  };

  /** Rx tab: append a prescription line to the patient's record. */
  addPolyclinicPrescription = (rx: { medicationId: string; dose: string; duration: string }) => {
    const patient = this.state.polyclinic.patient;
    if (!patient) return;
    const prescription = { ...rx, prescribedAt: Date.now() };
    this.updatePolyclinicPatient((p) => ({ ...p, prescriptions: [...(p.prescriptions ?? []), prescription] }));
    void (async () => {
      const attemptId = patient.investigationAttemptId ?? await this.initializeInvestigationAttempt();
      if (attemptId) await recordPrescription(attemptId, prescription);
    })().catch(() => undefined);
  };
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
