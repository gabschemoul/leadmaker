/**
 * Page Expéditeurs pendant le premier chargement (10/11/2026, règle « tout le statique s'affiche tout de
 * suite ») : vrais titres de cartes, vrais intitulés de rubriques et de champs ; seuls la liste des expéditeurs,
 * le nom de celui modifié et les valeurs des champs attendent la base. Composant serveur, sans données.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';
import { Trans } from '@kit/ui/trans';

const SECTIONS: Array<{ titleKey: string; fields: string[] }> = [
  {
    titleKey: 'outreach.sender.identitySection',
    fields: [
      'outreach.sender.civility',
      'outreach.sender.firstName',
      'outreach.sender.lastName',
      'outreach.sender.company',
      'outreach.sender.jobTitle',
    ],
  },
  {
    titleKey: 'outreach.sender.contactSection',
    fields: [
      'outreach.sender.email',
      'outreach.sender.phone',
      'outreach.sender.website',
    ],
  },
  {
    titleKey: 'outreach.sender.addressSection',
    fields: [
      'outreach.sender.address',
      'outreach.sender.zip',
      'outreach.sender.city',
      'outreach.sender.country',
    ],
  },
];

export function SendersLoading() {
  return (
    <div className={'flex flex-col gap-4'} aria-busy={true}>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey={'outreach.sender.listTitle'} />
          </CardTitle>

          <CardDescription className={'max-w-xl'}>
            <Trans i18nKey={'outreach.sender.listIntro'} />
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className={'flex flex-col divide-y rounded-lg border'}>
            {[0, 1].map((row) => (
              <div
                key={row}
                className={'flex items-center justify-between gap-3 px-4 py-3'}
              >
                <div className={'flex flex-col gap-1.5'}>
                  <Skeleton className={'h-4 w-48'} />
                  <Skeleton className={'h-3.5 w-36'} />
                </div>

                <Skeleton className={'h-8 w-48 rounded-md'} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className={'h-5 w-64'} />
          </CardTitle>

          <CardDescription className={'max-w-xl'}>
            <Trans i18nKey={'outreach.sender.intro'} />
          </CardDescription>
        </CardHeader>

        <CardContent className={'flex flex-col gap-8'}>
          {SECTIONS.map((section) => (
            <fieldset key={section.titleKey} className={'flex flex-col gap-4'}>
              <legend className={'mb-4 text-sm font-medium'}>
                <Trans i18nKey={section.titleKey} />
              </legend>

              <div className={'grid gap-4 md:grid-cols-2'}>
                {section.fields.map((field) => (
                  <div key={field} className={'flex flex-col gap-2'}>
                    <span className={'text-foreground text-sm font-medium'}>
                      <Trans i18nKey={field} />
                    </span>

                    <Skeleton className={'h-9 w-full rounded-md'} />
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
