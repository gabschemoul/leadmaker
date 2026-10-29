import { Badge } from '@kit/ui/badge';
import { badgeExtras } from '@kit/ui/badge-extras';
import { Trans } from '@kit/ui/trans';

import type { Database } from '~/lib/database.types';

type CampaignStatus = Database['public']['Enums']['lm_campaign_status'];

const STATUS_STYLES: Record<
  CampaignStatus,
  { variant: 'secondary' | 'outline' | 'default'; className?: string }
> = {
  draft: { variant: 'secondary' },
  running: { variant: 'default', className: badgeExtras.success },
  paused: { variant: 'outline', className: badgeExtras.warning },
  completed: { variant: 'default', className: badgeExtras.info },
  archived: { variant: 'outline' },
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
