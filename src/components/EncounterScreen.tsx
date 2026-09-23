import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { PerspectiveCamera } from 'three';
import {
  Polyclinic,
  POLYCLINIC_COLLIDERS,
  DOCTOR_CHAIR_POS,
  PATIENT_CHAIR_POS,
} from './three/Polyclinic';
import { Player } from './three/Player';
import { useActiveInteractable, interactionBus } from './three/interactions';
import {
  store,
  useGameState,
  POLYCLINIC_BED_INDEX,
} from '../game/store';
import { disposePatientConversation } from '../voice/conversationStore';
import { TopBar } from './primitives';
import { ExamineOverlay } from './ExamineOverlay';
import { DockedPatientAudioPanel } from './DockedPatientAudioPanel';
import { CompletionGate } from '../game/CompletionGate';

/** Adaptive FOV: keeps the horizontal FOV near 82° regardless of viewport
 *  aspect, plus a hold-Z (or scroll wheel) "lean in" zoom. */
function AdaptiveCameraFov() {
  const { camera, size } = useThree();
  const zoomedRef = useRef(false);
  const baseFovRef = useRef(55);
  const targetFovRef = useRef(55);

  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const targetHFov = (82 * Math.PI) / 180;
    const vFovRad = 2 * Math.atan(Math.tan(targetHFov / 2) / aspect);
    const baseFovDeg = Math.max(42, Math.min(68, (vFovRad * 180) / Math.PI));
    baseFovRef.current = baseFovDeg;
    targetFovRef.current = zoomedRef.current ? baseFovDeg * 0.4 : baseFovDeg;
  }, [size.width, size.height]);

  const zoomLevelRef = useRef(0);
  const applyZoom = () => {
    const z = zoomLevelRef.current;
    const base = baseFovRef.current;
    const min = base * 0.4;
    targetFovRef.current = base + (min - base) * z;
  };
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!document.pointerLockElement) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? -1 : 1;
      zoomLevelRef.current = Math.max(0, Math.min(1, zoomLevelRef.current + dir * 0.15));
      zoomedRef.current = zoomLevelRef.current > 0;
      applyZoom();
    };
    const isZoomKey = (e: KeyboardEvent) => e.key === 'z' || e.key === 'Z';
    const onDown = (e: KeyboardEvent) => {
      if (!isZoomKey(e) || !document.pointerLockElement) return;
      zoomLevelRef.current = 1;
      zoomedRef.current = true;
      applyZoom();
    };
    const onUp = (e: KeyboardEvent) => {
      if (!isZoomKey(e)) return;
      zoomLevelRef.current = 0;
      zoomedRef.current = false;
      applyZoom();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  useFrame(() => {
    const cam = camera as PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    const target = targetFovRef.current;
    const diff = target - cam.fov;
    if (Math.abs(diff) < 0.05) {
      if (cam.fov !== target) {
        cam.fov = target;
        cam.updateProjectionMatrix();
      }
      return;
    }
    cam.fov += diff * 0.22;
    cam.updateProjectionMatrix();
  });

  return null;
}

function Loader() {
  return (
    <Html center>
      <div
        style={{
          fontFamily: 'Nunito, sans-serif',
          fontWeight: 800,
          color: 'var(--peach-deep)',
          background: 'white',
          padding: '8px 14px',
          border: '3px solid var(--line)',
          borderRadius: 'var(--r-pill)',
          boxShadow: 'var(--plush-tiny)',
          fontSize: 13,
          letterSpacing: '0.05em',
        }}
      >
        Loading polyclinic…
      </div>
    </Html>
  );
}

function Crosshair() {
  const active = useActiveInteractable();
  const hot = !!active;
  const size = hot ? 14 : 6;
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: '50%',
        background: hot ? 'transparent' : 'rgba(255,248,236,0.85)',
        border: hot ? '2.5px solid var(--peach-deep)' : 'none',
        boxShadow: hot
          ? '0 0 12px rgba(255,142,92,0.55), 0 0 0 1px rgba(43,30,22,0.3)'
          : '0 0 0 1px rgba(43,30,22,0.4)',
        pointerEvents: 'none',
        transition: 'width 0.12s, height 0.12s, margin 0.12s, border 0.12s, box-shadow 0.12s',
      }}
    />
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        background: 'var(--cream)',
        padding: '2px 8px',
        borderRadius: 6,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
        border: '2px solid var(--line)',
        boxShadow: '0 2px 0 var(--line)',
        margin: '0 2px',
        color: 'var(--ink)',
      }}
    >
      {children}
    </span>
  );
}

export function EncounterScreen() {
  const state = useGameState();
  const patient = state.polyclinic.patient;

  const [pointerLocked, setPointerLocked] = useState(false);
  const [examineOpen, setExamineOpen] = useState(false);
  const [finishError, setFinishError] = useState('');
  const finishingGateRef = useRef(new CompletionGate());

  // If the user navigated straight here without a patient set, drop the
  // current selectedCaseId in. Without this the scene shows an empty room.
  useEffect(() => {
    if (!patient) store.loadPolyclinicPatient(state.selectedCaseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release pointer lock on unmount (e.g. navigating away mid-session).
  useEffect(() => {
    return () => {
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, []);

  // Track pointer-lock state so the bottom hint can swap copy AND so we
  // can hard-cancel any lock that engages while Examine is open. The
  // examineOpen ref is read inside a stable listener (closing over the
  // value via a ref keeps the listener stable across re-renders).
  const examineOpenRef = useRef(false);
  examineOpenRef.current = examineOpen;
  useEffect(() => {
    const onChange = () => {
      const locked = !!document.pointerLockElement;
      setPointerLocked(locked);
      if (locked && examineOpenRef.current) {
        // Examine owns the screen — never let the 3D controls steal the
        // cursor. Release immediately.
        document.exitPointerLock();
      }
    };
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, []);

  // When Examine is opened, force-exit any active pointer lock so the
  // modal can't be undermined by a stray scene click.
  useEffect(() => {
    if (!examineOpen) return;
    if (document.pointerLockElement) document.exitPointerLock();
    interactionBus.setActive(null);
  }, [examineOpen]);

  // Global E-to-examine — works whether or not pointer-lock is engaged.
  // The Player.tsx handler requires lock; this one fills the gap so the
  // keyboard shortcut works the same as the on-screen Examine button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'e' && e.key !== 'E') return;
      // Don't fire while typing into an input/textarea (defensive — there
      // aren't any today, but this guards against future text fields).
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      if (examineOpen) return;
      e.preventDefault();
      setExamineOpen(true);
      if (document.pointerLockElement) document.exitPointerLock();
      interactionBus.setActive(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [examineOpen]);

  // Dispose conversation when the patient changes / leaves.
  const currentPatientCaseId = patient?.case.id ?? null;
  useEffect(() => {
    return () => {
      disposePatientConversation(POLYCLINIC_BED_INDEX);
    };
  }, [currentPatientCaseId]);

  // Look-around is automatic while Examine is closed — PointerLockControls
  // mounts inside Player and engages on canvas click. When Examine opens
  // we tear it down so modal clicks can't bleed into the 3D scene.

  const openExamine = () => {
    if (document.pointerLockElement) document.exitPointerLock();
    interactionBus.setActive(null);
    setExamineOpen(true);
  };

  const handleInteract = (kind: 'desk' | 'bed', bedIndex?: number) => {
    // E (examine) on the patient — open the cozy examine overlay so the
    // doctor can take a history, order tests, read results, and submit a
    // diagnosis. Patient audio keeps running underneath the overlay.
    if (kind === 'bed' && bedIndex === POLYCLINIC_BED_INDEX) {
      openExamine();
    }
  };

  const endConsultation = () => {
    const active = store.getState().polyclinic.patient;
    if (!active?.submittedDiagnosisId) {
      setFinishError('Submit a diagnosis before finishing the consultation. Open Examine, choose Diagnose, and submit your selection.');
      setExamineOpen(true);
      return;
    }
    if (!finishingGateRef.current.tryStart()) return;
    setFinishError('');
    const startedAt = performance.now();
    if (document.pointerLockElement) document.exitPointerLock();
    interactionBus.setActive(null);
    if (!store.finishPolyclinicCase(true)) {
      finishingGateRef.current.reset();
      setFinishError('The encounter could not be finalized. Your evidence remains on this screen; please try again.');
      return;
    }
    disposePatientConversation(POLYCLINIC_BED_INDEX);
    if (import.meta.env.DEV) console.debug('[MedSim runtime]', {
      event: 'finish-to-debrief', durationMs: Math.round(performance.now() - startedAt),
    });
  };

  const SEATED_HEIGHT = 1.45;
  const playerSpawn = useMemo<[number, number, number]>(
    () => [DOCTOR_CHAIR_POS[0], SEATED_HEIGHT, DOCTOR_CHAIR_POS[2]],
    [],
  );
  const doctorLookAt = useMemo<[number, number, number]>(
    () => [PATIENT_CHAIR_POS[0], 1.3, PATIENT_CHAIR_POS[2]],
    [],
  );

  return (
    <div className="screen" style={{ background: 'var(--cream)', position: 'relative' }}>
      <TopBar here={4} steps={['Polyclinic', 'GP', 'Case', 'Brief', 'Encounter']} />

      <div
        style={{
          position: 'relative',
          height: 'calc(100vh - 67px)',
          overflow: 'hidden',
          // Hard-block any click bleeding into the 3D scene while the
          // examine modal owns the screen. PointerLockControls is gated
          // behind lookMode AND this — defence in depth.
          pointerEvents: examineOpen ? 'none' : undefined,
        }}
      >
        <Canvas
          shadows
          camera={{ position: playerSpawn, fov: 55 }}
          style={{ background: 'linear-gradient(#f0ebe1, #e3dac7)' }}
        >
          <AdaptiveCameraFov />
          <Suspense fallback={<Loader />}>
            <Polyclinic patientAudioVisible={!examineOpen} />
            <Player
              spawn={playerSpawn}
              colliders={POLYCLINIC_COLLIDERS}
              onInteract={handleInteract}
              height={SEATED_HEIGHT}
              locked
              lookAt={doctorLookAt}
              enableLook={!examineOpen}
            />
          </Suspense>
        </Canvas>

        {pointerLocked && <Crosshair />}

        {/* Action buttons — always visible, bottom-right */}
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            right: 18,
            zIndex: 6,
            display: 'flex',
            gap: 10,
          }}
        >
          {finishError && (
            <div role="alert" style={{ maxWidth: 420, background: 'var(--rose)', border: '3px solid var(--line)', borderRadius: 12, padding: '8px 12px', fontWeight: 800 }}>
              {finishError}
            </div>
          )}
          <button
            type="button"
            className="btn-plush primary"
            onClick={(e) => { e.stopPropagation(); openExamine(); }}
            style={{ fontSize: 14, padding: '12px 18px' }}
            aria-label="Examine patient"
          >
            Examine (E)
          </button>
          <button
            type="button"
            className="btn-plush ghost"
            onClick={(e) => {
              e.stopPropagation();
              endConsultation();
            }}
            style={{ fontSize: 14, padding: '12px 18px' }}
          >
            End consultation →
          </button>
        </div>

        {/* Hint chip — non-blocking. Adapts to whether mouse-look is engaged. */}
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            left: 18,
            zIndex: 6,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            background: 'white',
            border: '2.5px solid var(--line)',
            borderRadius: 'var(--r-pill)',
            padding: '6px 14px',
            boxShadow: 'var(--plush-tiny)',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--ink-2)',
            pointerEvents: 'none',
          }}
        >
          {pointerLocked ? (
            <>
              Type or choose a question in Examine · <Kbd>E</Kbd> examine · <Kbd>Esc</Kbd> release
            </>
          ) : (
            <>
              <span className="dot" style={{ background: 'var(--mint-deep)' }} />
              Patient text chat ready · click the room to look around · <Kbd>E</Kbd> examine
            </>
          )}
        </div>
      </div>

      {examineOpen && patient && (
        <>
          <DockedPatientAudioPanel
            patientName={patient.case.name}
            patientLabel={`${patient.case.age}${patient.case.gender}`}
          />
          <ExamineOverlay
            onClose={() => setExamineOpen(false)}
            onFinish={endConsultation}
            finishError={finishError}
          />
        </>
      )}
    </div>
  );
}
