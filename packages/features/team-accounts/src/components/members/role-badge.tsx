import { cva } from 'class-variance-authority';

import { Badge } from '@kit/ui/badge';
import { Trans } from '@kit/ui/trans';

type Role = string;

// Prospectigo (8/11/2026) : propriétaire en bleu pâle, membre en crème (charte du site)
const roles = {
  owner: '',
  member: '',
};

const roleClassNameBuilder = cva('font-medium capitalize shadow-none', {
  variants: {
    role: roles,
  },
});

export function RoleBadge({ role }: { role: Role }) {
  // @ts-expect-error: hard to type this since users can add custom roles
  const className = roleClassNameBuilder({ role });
  const isCustom = !(role in roles);

  return (
    <Badge
      className={className}
      variant={
        isCustom ? 'outline' : role === 'owner' ? 'default' : 'secondary'
      }
    >
      <span data-test={'member-role-badge'}>
        <Trans i18nKey={`common.roles.${role}.label`} defaults={role} />
      </span>
    </Badge>
  );
}
