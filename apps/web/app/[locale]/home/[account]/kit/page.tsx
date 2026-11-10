/**
 * Rôle : page « kit » (interne, non indexée) — montre côte à côte tous les éléments du socle visuel
 * de l'appli (relooking du 8/11/2026 : structure ElevenLabs, tableaux Apollo, couleurs Prospectigo)
 * pour validation avant de refaire les écrans. Textes en français, exemples fictifs et signalés.
 * Données : aucune. Écritures : aucune.
 */
import { Suspense } from 'react';

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Filter,
  Info,
  MoreHorizontal,
  Pencil,
  Plus,
  Radar,
  Search,
  Send,
  Target,
} from 'lucide-react';

import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Badge } from '@kit/ui/badge';
import { badgeExtras } from '@kit/ui/badge-extras';
import { Button } from '@kit/ui/button';
import { buttonExtras } from '@kit/ui/button-extras';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { PageBody } from '@kit/ui/page';
import { Switch } from '@kit/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

import { CampaignStatusBadge } from '../_components/leadmaker/campaign-status-badge';
import { EmptyPanel } from '../_components/leadmaker/empty-panel';
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { KitDrawerDemo } from './_components/kit-drawer-demo';

export const metadata = {
  title: 'Kit — socle visuel',
  robots: { index: false, follow: false },
};

interface KitPageProps {
  params: Promise<{ account: string }>;
}

function KitPage({ params }: KitPageProps) {
  return (
    <PageBody>
      <Suspense fallback={null}>
        <KitHeader params={params} />
      </Suspense>

      <div className={'flex flex-col gap-12 pb-32'}>
        <Section
          id={'couleurs'}
          title={'Couleurs'}
          text={
            'Fond pierre, gris chauds, noir pour les actions neutres, bleu Klein pour l’action principale.'
          }
        >
          <div className={'flex flex-wrap gap-3'}>
            <Swatch className={'bg-background'} label={'Fond de page'} />
            <Swatch className={'bg-sidebar'} label={'Barre latérale'} />
            <Swatch className={'bg-muted'} label={'Survol / actif'} />
            <Swatch className={'bg-card'} label={'Panneaux'} />
            <Swatch className={'bg-primary'} label={'Noir'} dark />
            <Swatch className={'bg-brand'} label={'Bleu Klein'} dark />
            <Swatch className={'bg-brand-pale'} label={'Bleu pâle'} />
            <Swatch className={'bg-border'} label={'Filets'} />
          </div>
        </Section>

        <Section
          id={'boutons'}
          title={'Boutons'}
          text={
            'Un seul bouton bleu par écran : l’action principale. Le noir pour les actions neutres, le contour pour le reste.'
          }
        >
          <Row>
            <Button className={buttonExtras.brand}>
              <Plus /> Nouvelle campagne
            </Button>
            <Button>Enregistrer</Button>
            <Button variant={'outline'}>
              <Pencil /> Modifier
            </Button>
            <Button variant={'secondary'}>Secondaire</Button>
            <Button variant={'ghost'}>Discret</Button>
            <Button variant={'destructive'}>Archiver</Button>
            <Button variant={'link'}>Lien</Button>
          </Row>

          <Row>
            <Button size={'sm'} className={buttonExtras.brand}>
              Petit bleu
            </Button>
            <Button size={'sm'} variant={'outline'}>
              Petit contour
            </Button>
            <Button size={'lg'} className={buttonExtras.brand}>
              Grand bleu
            </Button>
            <Button className={cn(buttonExtras.brand, buttonExtras.pill)}>
              Lancer la campagne <ArrowRight />
            </Button>
            <Button variant={'outline'} className={buttonExtras.pill}>
              Réserver une démo
            </Button>
            <Button loading>En cours…</Button>
            <Button variant={'outline'} size={'icon'} aria-label={'Plus'}>
              <MoreHorizontal />
            </Button>
          </Row>
        </Section>

        <Section
          id={'champs'}
          title={'Champs de saisie'}
          text={'36 px de haut, bord à 10 %, étiquette au-dessus.'}
        >
          <div className={'grid max-w-3xl gap-5 sm:grid-cols-2'}>
            <Field label={'Nom de la campagne'}>
              <Input placeholder={'Par exemple : Restaurants de Lyon'} />
            </Field>

            <Field label={'Recherche'}>
              <div className={'relative'}>
                <Search
                  className={
                    'text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
                  }
                />
                <Input className={'pl-9'} placeholder={'Nom, ville, site…'} />
              </div>
            </Field>

            <Field label={'Message'} className={'sm:col-span-2'}>
              <Textarea
                rows={3}
                placeholder={
                  'Bonjour, nous avons regardé la présence en ligne de votre entreprise…'
                }
              />
            </Field>

            <div className={'flex items-center gap-3'}>
              <Checkbox id={'kit-check'} defaultChecked />
              <Label htmlFor={'kit-check'}>
                Inclure les entreprises sans site
              </Label>
            </div>

            <div className={'flex items-center gap-3'}>
              <Switch id={'kit-switch'} defaultChecked />
              <Label htmlFor={'kit-switch'}>Pilote automatique</Label>
            </div>
          </div>
        </Section>

        <Section
          id={'pastilles'}
          title={'Pastilles de statut'}
          text={
            'Une seule famille : gris brouillon, bleu en cours, ambre en pause ou à vérifier, noir terminé, contour archivé, vert validé.'
          }
        >
          <Row>
            <CampaignStatusBadge status={'draft'} />
            <CampaignStatusBadge status={'running'} />
            <CampaignStatusBadge status={'paused'} />
            <CampaignStatusBadge status={'completed'} />
            <CampaignStatusBadge status={'archived'} />
            <Badge variant={'secondary'} className={badgeExtras.success}>
              <Check /> Validé
            </Badge>
            <Badge variant={'secondary'} className={badgeExtras.warning}>
              <AlertTriangle /> À vérifier
            </Badge>
            <Badge
              variant={'secondary'}
              className={cn(badgeExtras.dot, badgeExtras.brand)}
            >
              Prêt
            </Badge>
            <Badge variant={'secondary'}>Message 2</Badge>
          </Row>
        </Section>

        <Section
          id={'onglets'}
          title={'Onglets et étapes'}
          text={
            'Onglets soulignés sous le titre pour découper une campagne. Bande d’étapes avec l’étape en cours en bleu.'
          }
        >
          <Tabs defaultValue={'apercu'} className={'gap-4'}>
            <TabsList
              variant={'line'}
              className={'w-full justify-start border-b pb-1'}
            >
              {[
                ['apercu', 'Aperçu'],
                ['ciblage', 'Ciblage'],
                ['messages', 'Messages'],
                ['prospects', 'Prospects'],
                ['formulaires', 'Formulaires'],
                ['reglages', 'Réglages'],
              ].map(([value, label]) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className={'flex-none px-2'}
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value={'apercu'}>
              <StepsBand />
            </TabsContent>

            {[
              'ciblage',
              'messages',
              'prospects',
              'formulaires',
              'reglages',
            ].map((value) => (
              <TabsContent key={value} value={value}>
                <p className={'text-muted-foreground text-sm'}>
                  Contenu de l’onglet « {value} » (exemple).
                </p>
              </TabsContent>
            ))}
          </Tabs>
        </Section>

        <Section
          id={'chiffres'}
          title={'Chiffres clés'}
          text={
            'Dans un seul panneau, séparés par des filets, étiquette en capitales.'
          }
        >
          <Card className={'py-0'}>
            <div
              className={
                'grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0'
              }
            >
              <Kpi
                label={'À vérifier'}
                value={'234'}
                hint={'formulaires'}
                highlight
              />
              <Kpi
                label={'Campagnes en cours'}
                value={'2'}
                hint={'sur 10 autorisées'}
              />
              <Kpi
                label={'Crédits'}
                value={'37 506'}
                hint={'40 000 par mois'}
              />
            </div>
          </Card>
        </Section>

        <Section
          id={'bandeaux'}
          title={'Bandeaux d’information'}
          text={
            'Gris pour informer, ambre pour alerter. Jamais de rouge sauf erreur bloquante.'
          }
        >
          <Banner icon={<Info />}>
            <b className={'font-medium'}>Recherche sur l’ordinateur dédié.</b>{' '}
            Les recherches de cette campagne n’avancent que quand il est allumé.
            Dernier signe il y a 2 min.
          </Banner>

          <Banner tone={'warning'} icon={<AlertTriangle />}>
            <b className={'font-medium'}>Aucun expéditeur configuré.</b> Ajoutez
            vos coordonnées avant de lancer la prise de contact.{' '}
            <a className={'underline underline-offset-2'} href={'#bandeaux'}>
              Ajouter un expéditeur
            </a>
          </Banner>
        </Section>

        <Section
          id={'tableau'}
          title={'Tableau'}
          text={
            'Barre d’outils au-dessus, en-tête gris en capitales, lignes de 48 px, actions dans la ligne, pagination en bas. Données d’exemple.'
          }
        >
          <Card className={'gap-0 py-0'}>
            <div
              className={'flex flex-wrap items-center gap-2 border-b px-4 py-3'}
            >
              <div className={'relative w-full max-w-xs'}>
                <Search
                  className={
                    'text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
                  }
                />
                <Input
                  className={'h-8 pl-9'}
                  placeholder={'Rechercher une campagne'}
                />
              </div>

              <Button variant={'outline'} size={'sm'}>
                <Filter /> Filtres
                <Badge variant={'secondary'} className={'ml-1 h-4 px-1.5'}>
                  1
                </Badge>
              </Button>

              <Button variant={'outline'} size={'sm'}>
                Étape : toutes
              </Button>

              <div className={'ml-auto flex items-center gap-2'}>
                <Button variant={'outline'} size={'sm'}>
                  Exporter en CSV
                </Button>
                <Button size={'sm'} className={buttonExtras.brand}>
                  <Plus /> Nouvelle campagne
                </Button>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={'w-10'}>
                    <Checkbox aria-label={'Tout sélectionner'} />
                  </TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Étape</TableHead>
                  <TableHead>Pays</TableHead>
                  <TableHead className={'text-right'}>Prospects</TableHead>
                  <TableHead className={'text-right'}>Contactés</TableHead>
                  <TableHead>Dernière activité</TableHead>
                  <TableHead className={'w-40'} />
                </TableRow>
              </TableHeader>

              <TableBody>
                {EXAMPLE_ROWS.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell>
                      <Checkbox aria-label={`Sélectionner ${row.name}`} />
                    </TableCell>

                    <TableCell>
                      <a
                        className={
                          'font-medium underline-offset-4 hover:underline'
                        }
                        href={'#tableau'}
                      >
                        {row.name}
                      </a>
                      <div className={'text-muted-foreground text-xs'}>
                        {row.sub}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className={'flex items-center gap-2'}>
                        <CampaignStatusBadge status={row.status} />
                        <span className={'text-muted-foreground'}>
                          {row.step}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell>{row.country}</TableCell>

                    <TableCell className={'text-right tabular-nums'}>
                      {row.prospects}
                    </TableCell>

                    <TableCell className={'text-right tabular-nums'}>
                      {row.contacted}
                    </TableCell>

                    <TableCell className={'text-muted-foreground'}>
                      {row.activity}
                    </TableCell>

                    <TableCell className={'text-right'}>
                      <div className={'flex items-center justify-end gap-1'}>
                        <Button variant={'outline'} size={'sm'}>
                          {row.action}
                        </Button>
                        <Button
                          variant={'ghost'}
                          size={'icon-sm'}
                          aria-label={'Plus'}
                        >
                          <MoreHorizontal />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div
              className={
                'text-muted-foreground flex items-center justify-between border-t px-4 py-2.5 text-[14px]'
              }
            >
              <span>1 – 5 sur 9 campagnes</span>

              <div className={'flex items-center gap-1'}>
                <Button variant={'outline'} size={'sm'} disabled>
                  Précédent
                </Button>
                <Button variant={'outline'} size={'sm'}>
                  Suivant
                </Button>
              </div>
            </div>
          </Card>
        </Section>

        <Section
          id={'panneaux'}
          title={'Panneaux'}
          text={
            'Blanc, bord à 8 %, arrondi 12 px, sans ombre. Le titre et la description en haut, l’action à droite.'
          }
        >
          <div className={'grid gap-4 lg:grid-cols-[1fr_360px]'}>
            <Card>
              <CardHeader
                className={'flex flex-row items-start justify-between'}
              >
                <div className={'flex flex-col gap-1'}>
                  <CardTitle>Qui envoie ?</CardTitle>
                  <CardDescription>
                    Ces coordonnées sont écrites dans chaque formulaire de
                    contact.
                  </CardDescription>
                </div>

                <Button variant={'outline'} size={'sm'}>
                  Modifier
                </Button>
              </CardHeader>

              <CardContent className={'flex items-center gap-3'}>
                <div
                  className={
                    'bg-muted flex size-10 items-center justify-center rounded-full text-sm font-medium'
                  }
                >
                  LW
                </div>
                <div className={'text-sm'}>
                  <div className={'font-medium'}>
                    Laurie Wang · Review Cleaner
                  </div>
                  <div className={'text-muted-foreground'}>
                    laurie@review-cleaner.com · 07 56 85 37 28
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={'bg-muted/40'}>
              <CardHeader>
                <CardTitle>Estimation</CardTitle>
                <CardDescription>
                  Villes et recherches à faire selon votre ciblage.
                </CardDescription>
              </CardHeader>

              <CardContent className={'flex flex-col gap-3 text-sm'}>
                <div className={'flex justify-between'}>
                  <span className={'text-muted-foreground'}>Villes</span>
                  <span className={'tabular-nums'}>1 240</span>
                </div>
                <div className={'flex justify-between'}>
                  <span className={'text-muted-foreground'}>Recherches</span>
                  <span className={'tabular-nums'}>3 720</span>
                </div>
                <div className={'flex justify-between border-t pt-3'}>
                  <span className={'text-muted-foreground'}>Vos crédits</span>
                  <span className={'tabular-nums'}>37 497</span>
                </div>

                <Button className={cn(buttonExtras.brand, 'mt-2 w-full')}>
                  Créer la campagne
                </Button>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section
          id={'vide'}
          title={'État vide'}
          text={
            'Quand il n’y a encore rien : un panneau bleu pâle qui explique et propose l’action.'
          }
        >
          <EmptyPanel
            icon={<Radar />}
            title={'Créez votre première campagne'}
            description={
              'Choisissez une zone géographique et un secteur d’activité : Prospectigo trouve les entreprises qui correspondent et les contacte pour vous.'
            }
            actions={
              <>
                <Button className={buttonExtras.brand}>
                  <Plus /> Nouvelle campagne
                </Button>
                <Button variant={'outline'}>Voir un exemple</Button>
              </>
            }
            features={[
              {
                icon: <Target />,
                title: 'Ciblez',
                text: 'Une zone, un secteur, des critères : la liste se construit toute seule.',
              },
              {
                icon: <Search />,
                title: 'Trouvez',
                text: 'Les entreprises qui correspondent, avec site, téléphone et note moyenne.',
              },
              {
                icon: <Send />,
                title: 'Contactez',
                text: 'Vos messages partent par les formulaires de contact, au rythme choisi.',
              },
            ]}
          />
        </Section>

        <Section
          id={'tiroir'}
          title={'Tiroir de fiche'}
          text={
            'Cliquer un prospect ou un formulaire ouvre une fiche par la droite, le tableau reste derrière.'
          }
        >
          <KitDrawerDemo />
        </Section>
      </div>
    </PageBody>
  );
}

export default KitPage;

async function KitHeader({ params }: KitPageProps) {
  const { account } = await params;

  return (
    <TeamAccountLayoutPageHeader
      account={account}
      title={'Kit — socle visuel'}
      description={<AppBreadcrumbs />}
    >
      <Badge variant={'outline'}>Page interne · exemples fictifs</Badge>
    </TeamAccountLayoutPageHeader>
  );
}

function Section(
  props: React.PropsWithChildren<{ id: string; title: string; text: string }>,
) {
  return (
    <section id={props.id} className={'flex flex-col gap-4'}>
      <div className={'flex flex-col gap-1'}>
        <h2 className={'font-heading text-lg font-medium tracking-tight'}>
          {props.title}
        </h2>
        <p className={'text-muted-foreground max-w-2xl text-sm'}>
          {props.text}
        </p>
      </div>

      {props.children}
    </section>
  );
}

function Row(props: React.PropsWithChildren) {
  return (
    <div className={'flex flex-wrap items-center gap-2'}>{props.children}</div>
  );
}

function Field(
  props: React.PropsWithChildren<{ label: string; className?: string }>,
) {
  return (
    <div className={cn('flex flex-col gap-1.5', props.className)}>
      <Label>{props.label}</Label>
      {props.children}
    </div>
  );
}

function Swatch(props: { className: string; label: string; dark?: boolean }) {
  return (
    <div className={'flex w-28 flex-col gap-1.5'}>
      <div
        className={cn('ring-border h-12 rounded-lg ring-1', props.className)}
      />
      <span className={'text-muted-foreground text-xs'}>{props.label}</span>
    </div>
  );
}

function Kpi(props: {
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <div className={'flex flex-col gap-1 px-5 py-4'}>
      <span
        className={
          'text-muted-foreground font-mono text-[12px] font-medium tracking-[0.06em] uppercase'
        }
      >
        {props.label}
      </span>
      <span
        className={cn('font-heading text-2xl tracking-tight tabular-nums', {
          'text-brand': props.highlight,
        })}
      >
        {props.value}
      </span>
      <span className={'text-muted-foreground text-xs'}>{props.hint}</span>
    </div>
  );
}

function Banner(
  props: React.PropsWithChildren<{
    icon: React.ReactNode;
    tone?: 'info' | 'warning';
  }>,
) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg px-4 py-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
        props.tone === 'warning'
          ? 'bg-amber-500/10 text-amber-900 dark:text-amber-200 [&_svg]:text-amber-600'
          : 'bg-muted text-foreground [&_svg]:text-muted-foreground',
      )}
    >
      {props.icon}
      <div>{props.children}</div>
    </div>
  );
}

function StepsBand() {
  const steps = [
    { label: 'Cibler', hint: 'États-Unis · 27 216 villes', state: 'done' },
    { label: 'Trouver', hint: 'En cours · 70 348 trouvés', state: 'current' },
    { label: 'Rédiger', hint: 'Message à écrire', state: 'todo' },
    { label: 'Contacter', hint: 'Pas encore', state: 'todo' },
  ] as const;

  return (
    <Card className={'py-0'}>
      <div className={'grid divide-y sm:grid-cols-4 sm:divide-x sm:divide-y-0'}>
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={cn('flex items-center gap-3 px-5 py-4', {
              'bg-brand-pale/60': step.state === 'current',
            })}
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                {
                  'bg-primary text-primary-foreground': step.state === 'done',
                  'bg-brand text-brand-foreground': step.state === 'current',
                  'bg-muted text-muted-foreground': step.state === 'todo',
                },
              )}
            >
              {step.state === 'done' ? (
                <Check className={'size-3.5'} />
              ) : (
                index + 1
              )}
            </span>

            <div className={'flex min-w-0 flex-col'}>
              <span className={'text-sm font-medium'}>{step.label}</span>
              <span className={'text-muted-foreground truncate text-xs'}>
                {step.hint}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const EXAMPLE_ROWS = [
  {
    name: 'NAMMA BOOSTER - Service',
    sub: 'Créée le 4 nov. 2026',
    status: 'running',
    step: 'Trouver',
    country: 'États-Unis',
    prospects: '70 345',
    contacted: '0',
    activity: 'il y a 2 min',
    action: 'Rédiger le message',
  },
  {
    name: 'Meubles France',
    sub: 'Créée le 3 nov. 2026',
    status: 'paused',
    step: 'Contacter',
    country: 'France',
    prospects: '65 679',
    contacted: '210',
    activity: 'il y a 1 h',
    action: 'Vérifier 98',
  },
  {
    name: 'Agences digital',
    sub: 'Créée le 2 nov. 2026',
    status: 'running',
    step: 'Trouver',
    country: 'France',
    prospects: '36 705',
    contacted: '0',
    activity: 'il y a 10 min',
    action: 'Rédiger le message',
  },
  {
    name: 'Électricien - Grandes villes (copie)',
    sub: 'Créée le 1 nov. 2026',
    status: 'draft',
    step: 'Cibler',
    country: 'France',
    prospects: '0',
    contacted: '0',
    activity: 'hier',
    action: 'Lancer la recherche',
  },
  {
    name: 'Plombiers - Grandes villes',
    sub: 'Créée le 31 oct. 2026',
    status: 'completed',
    step: 'Rédiger',
    country: 'France',
    prospects: '1 118',
    contacted: '0',
    activity: 'il y a 3 j',
    action: 'Rédiger le message',
  },
] as const;
