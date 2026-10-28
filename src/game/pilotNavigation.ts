import type { Screen } from './types.ts';

export interface PilotRoute {
  screen: Screen;
  caseId?: string;
  attemptId?: string;
  reviewId?: string;
  examine?: boolean;
  onboardingStep?: number;
}
const screens: Screen[] = ['splash', 'onboarding', 'auth', 'home', 'gpRoom', 'library', 'brief', 'encounter', 'endConfirm', 'debrief', 'history'];
export function routeHash(route: PilotRoute): string {
  const query = new URLSearchParams();
  if (route.caseId) query.set('case', route.caseId);
  if (route.reviewId) query.set('review', route.reviewId);
  if (route.examine && route.screen === 'encounter') query.set('panel', 'examine');
  if (route.screen === 'onboarding' && route.onboardingStep) query.set('step', String(route.onboardingStep));
  return `#/${route.screen}${query.size ? `?${query}` : ''}`;
}
export function readRoute(hash: string, state: unknown): PilotRoute {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const screen = screens.includes(path as Screen) ? path as Screen : 'splash';
  const query = new URLSearchParams(search);
  const saved = state as { medsim?: PilotRoute } | null;
  return { screen, caseId: query.get('case') ?? undefined, reviewId: query.get('review') ?? undefined,
    examine: screen === 'encounter' && query.get('panel') === 'examine',
    onboardingStep: screen === 'onboarding' ? Math.max(0, Math.min(2, Number(query.get('step')) || 0)) : undefined,
    // Attempt references stay out of URLs; they are never authentication credentials.
    attemptId: saved?.medsim && routeHash(saved.medsim) === hash ? saved.medsim.attemptId : undefined };
}

export interface HistorySurface {
  location: { hash: string };
  history: { state: unknown; pushState(data: unknown, unused: string, url: string): void; replaceState(data: unknown, unused: string, url: string): void; go(delta: number): void };
  addEventListener(type: 'popstate', fn: () => void): void;
  removeEventListener(type: 'popstate', fn: () => void): void;
}

/** One entry per screen/overlay transition, with no entries for dialogue or evidence updates. */
export class PilotHistory {
  private index = 0;
  private reverting = false;
  private route: PilotRoute;
  private previous: PilotRoute | undefined;
  private surface: HistorySurface;
  private apply: (route: PilotRoute) => void;
  private allow: (route: PilotRoute) => boolean;
  constructor(surface: HistorySurface, apply: (route: PilotRoute) => void, allow: (route: PilotRoute) => boolean) {
    this.surface = surface;
    this.apply = apply;
    this.allow = allow;
    this.route = readRoute(surface.location.hash, surface.history.state);
    this.index = (surface.history.state as { medsimIndex?: number } | null)?.medsimIndex ?? 0;
    this.previous = (surface.history.state as { medsimPrevious?: PilotRoute } | null)?.medsimPrevious;
    surface.history.replaceState({ medsim: this.route, medsimIndex: this.index, medsimPrevious: this.previous }, '', routeHash(this.route));
    surface.addEventListener('popstate', this.onPop);
  }
  current() { return this.route; }
  write(route: PilotRoute, replace = false) {
    if (JSON.stringify(route) === JSON.stringify(this.route)) return;
    if (routeHash(route) === routeHash(this.route)) replace = true;
    if (!replace) { this.index++; this.previous = this.route; }
    this.route = route;
    this.surface.history[replace ? 'replaceState' : 'pushState']({ medsim: route, medsimIndex: this.index, medsimPrevious: this.previous }, '', routeHash(route));
  }
  backTo(screen: Screen) {
    if (this.previous?.screen !== screen) return false;
    this.surface.history.go(-1);
    return true;
  }
  private onPop = () => {
    if (this.reverting) { this.reverting = false; return; }
    const target = readRoute(this.surface.location.hash, this.surface.history.state);
    const index = (this.surface.history.state as { medsimIndex?: number } | null)?.medsimIndex ?? this.index - 1;
    if (!this.allow(target)) {
      this.reverting = true;
      this.surface.history.go(this.index - index || 1);
      return;
    }
    this.index = index;
    this.route = target;
    this.previous = (this.surface.history.state as { medsimPrevious?: PilotRoute } | null)?.medsimPrevious;
    this.apply(target);
  };
  dispose() { this.surface.removeEventListener('popstate', this.onPop); }
}
