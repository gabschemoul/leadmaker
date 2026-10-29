'use client';

import { useRouter } from 'next/navigation';

import {
  type ProspectsListState,
  buildProspectsHref,
} from '~/lib/leadmaker/prospects-query';

import { isProspectSortKey } from '../../_components/leadmaker/prospect-columns';
import {
  type ProspectRow,
  ProspectsTable,
  type SortingState,
} from '../../_components/leadmaker/prospects-table';

/**
 * Tableau de la page Prospects : le tri cliqué dans l'en-tête est écrit dans
 * l'URL, et le serveur renvoie la page triée.
 */
export function ProspectsList(props: {
  basePath: string;
  state: ProspectsListState;
  /** identifiant du dossier à garder dans l'URL (absent avec un seul dossier) */
  space: string | undefined;
  prospects: ProspectRow[];
  accountId: string;
  campaignsPath: string;
  canDelete: boolean;
  noResultsMessage: React.ReactNode;
}) {
  const router = useRouter();

  const sorting: SortingState = [
    { id: props.state.sort, desc: props.state.dir === 'desc' },
  ];

  const onSortingChange = (next: SortingState) => {
    const [first] = next;

    if (!first || !isProspectSortKey(first.id)) return;

    router.push(
      buildProspectsHref(props.basePath, {
        ...props.state,
        space: props.space,
        page: 1,
        sort: first.id,
        dir: first.desc ? 'desc' : 'asc',
      }),
    );
  };

  return (
    <ProspectsTable
      prospects={props.prospects}
      accountId={props.accountId}
      campaignsPath={props.campaignsPath}
      canDelete={props.canDelete}
      sorting={sorting}
      onSortingChange={onSortingChange}
      noResultsMessage={props.noResultsMessage}
    />
  );
}
