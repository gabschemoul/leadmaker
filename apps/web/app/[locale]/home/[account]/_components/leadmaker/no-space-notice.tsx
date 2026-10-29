import Link from 'next/link';

import { FolderKanban } from 'lucide-react';

import {
  EmptyMedia,
  EmptyState,
  EmptyStateButton,
  EmptyStateHeading,
  EmptyStateText,
} from '@kit/ui/empty-state';
import { Trans } from '@kit/ui/trans';

import pathsConfig from '~/config/paths.config';

/** Affiché tant que l'organisation n'a aucun espace. */
export function NoSpaceNotice(props: { account: string }) {
  return (
    <EmptyState className={'py-16'} data-test={'no-space-notice'}>
      <EmptyMedia variant={'icon'}>
        <FolderKanban />
      </EmptyMedia>

      <EmptyStateHeading>
        <Trans i18nKey={'campaigns.noSpace.title'} />
      </EmptyStateHeading>

      <EmptyStateText>
        <Trans i18nKey={'campaigns.noSpace.description'} />
      </EmptyStateText>

      <EmptyStateButton
        nativeButton={false}
        data-test={'no-space-create-link'}
        render={
          <Link
            href={pathsConfig.app.accountSpaces.replace(
              '[account]',
              props.account,
            )}
          />
        }
      >
        <Trans i18nKey={'campaigns.noSpace.cta'} />
      </EmptyStateButton>
    </EmptyState>
  );
}
