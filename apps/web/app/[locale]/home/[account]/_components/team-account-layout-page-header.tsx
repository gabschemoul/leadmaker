import { PageHeader } from '@kit/ui/page';

/**
 * En-tête de page de l'organisation : le fil d'Ariane et le bouton de la barre
 * latérale vivent désormais dans la barre du haut (TeamAccountTopBar), la page
 * ne garde que son titre et ses actions (relooking du 8/11/2026).
 */
export function TeamAccountLayoutPageHeader(
  props: React.PropsWithChildren<{
    title: string | React.ReactNode;
    description?: string | React.ReactNode;
    /** inutilisé (ancien fil d'Ariane) ; gardé pour compatibilité */
    account?: string;
  }>,
) {
  return (
    <PageHeader title={props.title} displaySidebarTrigger={false}>
      {props.children}
    </PageHeader>
  );
}
