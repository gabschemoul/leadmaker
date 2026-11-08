import { Badge } from '@kit/ui/badge';
import { badgeExtras } from '@kit/ui/badge-extras';
import { Trans } from '@kit/ui/trans';

import type { Database } from '~/lib/database.types';

type CampaignStatus = Database['public']['Enums']['lm_campaign_status'];

/**
 * Une seule famille de pastilles (charte du site, 8/11/2026) : crème = brouillon, bleu pâle = en cours,
 * ambre = en pause, vert = recherche terminée, contour = archivée.
 */
const STATUS_STYLES: Record<
  CampaignStatus,
  { variant: 'secondary' | 'outline' | 'default'; className?: string }
> = {
  draft: { variant: 'secondary' },
  running: { variant: 'default', className: badgeExtras.dot },
  paused: { variant: 'secondary', className: badgeExtras.warning },
  completed: { variant: 'secondary', className: badgeExtras.success },
  archived: { variant: 'outline', className: 'text-muted-foreground' },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const style = STATUS_STYLES[status];

  return (
    <Badge
      variant={style.variant}
      className={style.className}
      data-test={`campaign-status-${status}`}
    >
      <Trans i18nKey={`campaigns.status.${status}`} />
    </Badge>
  );
}
