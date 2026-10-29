/**
 * Libellé affiché d'un dossier client (table lm_spaces).
 *
 * L'espace par défaut, créé automatiquement pour chaque organisation, porte un
 * nom technique (« Default ») : on affiche à la place un libellé traduit
 * (« Mon entreprise »), passé par l'appelant.
 */
export function spaceLabel(
  space: { name: string; is_default: boolean },
  defaultLabel: string,
) {
  return space.is_default ? defaultLabel : space.name;
}
