import type { AgentStep } from '../types.js';

const LOOP_WINDOW = 20;

interface LoopNudge {
  level: 'gentle' | 'warning' | 'urgent';
  message: string;
}

/**
 * Soft, escalating loop detection. Never blocks actions — returns a nudge message
 * at increasing severity thresholds if the agent appears stuck.
 *
 * Also detects stagnant pages (same URL + similar element count for 5+ steps).
 */
export function detectLoop(action: { action: string; ref?: string }, history: AgentStep[]): LoopNudge | null {
  if (history.length < 5) return null;

  const actionKey = `${action.action}:${action.ref ?? ''}`;
  const window = history.slice(-LOOP_WINDOW);
  const windowKeys = window.map((h) => `${h.action.action}:${h.action.ref ?? ''}`);

  // Count how many times this exact action appears in the window
  const repetitions = windowKeys.filter((k) => k === actionKey).length;

  if (repetitions >= 12) {
    return {
      level: 'urgent',
      message:
        'STUCK: You have repeated this exact action 12+ times. This approach is not working. You MUST try something completely different. If a popup, date picker, or overlay is blocking the UI, use "keyboard" with "Escape" to close it. Otherwise try a different element, a different page, or a different strategy entirely.',
    };
  }

  if (repetitions >= 8) {
    return {
      level: 'warning',
      message:
        'You have repeated this action 8+ times. Consider whether this approach is making progress. If not, try pressing Escape to dismiss any blocking popups or overlays, then try a different path — use site navigation, search, or a different element.',
    };
  }

  if (repetitions >= 5) {
    return {
      level: 'gentle',
      message:
        'You have repeated this action several times. If you are making progress with each repetition, keep going. If not, try a different approach: use "keyboard" with "Escape" to close any blocking popups, date pickers, or overlays, then try a different element or strategy.',
    };
  }

  // Stagnant page detection: same URL for 5+ consecutive steps
  const recentUrls = window.slice(-5).map((h) => h.url);
  if (recentUrls.length >= 5 && recentUrls.every((u) => u === recentUrls[0])) {
    const recentActions = new Set(windowKeys.slice(-5));
    if (recentActions.size <= 2) {
      return {
        level: 'warning',
        message:
          'You have been on the same page for 5+ steps with very few different actions. The content you need may be elsewhere — try navigating to a different page or section.',
      };
    }
  }

  return null;
}
