import type { Database } from '@kit/supabase/database';

export type AttemptStatus = Database['public']['Enums']['lm_attempt_status'];

/** Onglets de la page Formulaires : chaque groupe regroupe un ou plusieurs statuts. */
export const ATTEMPT_GROUPS = {
  ready: ['ready'],
  incomplete: ['incomplete'],
  intervention_required: ['intervention_required'],
  validated: ['validated'],
  preparing: ['pending', 'preparing'],
  no_form: ['no_form'],
  unreachable: ['unreachable', 'failed'],
  skipped: ['skipped'],
  to_verify: ['to_verify'],
  sent: ['sending', 'sent'],
  excluded: ['excluded'],
} as const satisfies Record<string, readonly AttemptStatus[]>;

export type AttemptGroup = keyof typeof ATTEMPT_GROUPS;

export const ATTEMPT_GROUP_ORDER = Object.keys(
  ATTEMPT_GROUPS,
) as AttemptGroup[];

/** Groupes toujours affichés, même vides. */
export const ALWAYS_VISIBLE_GROUPS: AttemptGroup[] = [
  'ready',
  'incomplete',
  'intervention_required',
  'validated',
  'to_verify',
  'sent',
];

export function isAttemptGroup(value: unknown): value is AttemptGroup {
  return typeof value === 'string' && value in ATTEMPT_GROUPS;
}

export function groupOfStatus(status: AttemptStatus): AttemptGroup {
  for (const group of ATTEMPT_GROUP_ORDER) {
    if ((ATTEMPT_GROUPS[group] as readonly AttemptStatus[]).includes(status)) {
      return group;
    }
  }

  return 'unreachable';
}

/** Libellés des champs manquants (colonne jsonb `missing`). */
export function missingLabels(missing: unknown): string[] {
  return Array.isArray(missing)
    ? missing.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Valeurs saisies à la main (colonne jsonb `extra`). */
export function extraValues(extra: unknown): Record<string, string> {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {};

  return Object.fromEntries(
    Object.entries(extra as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** Champs remplis par le robot : type de champ → libellé sur le site. */
export function filledEntries(filled: unknown): Array<[string, string]> {
  if (!filled || typeof filled !== 'object' || Array.isArray(filled)) return [];

  return Object.entries(filled as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
}

/** Une tentative « avec alerte » demande un regard humain avant validation. */
export function hasAlert(attempt: {
  detail: string | null;
  missing: unknown;
  protection_type: string | null;
}) {
  return (
    Boolean(attempt.detail) ||
    missingLabels(attempt.missing).length > 0 ||
    Boolean(attempt.protection_type)
  );
}
