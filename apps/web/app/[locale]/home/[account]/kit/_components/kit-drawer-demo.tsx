'use client';

/**
 * Rôle : démonstration du tiroir de fiche (prospect / formulaire) pour la page « kit ».
 * Données : aucune (exemple statique). Écritures : aucune.
 */
import { ExternalLink, Globe, Phone, Star } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { badgeExtras } from '@kit/ui/badge-extras';
import { Button } from '@kit/ui/button';
import { buttonExtras } from '@kit/ui/button-extras';
import { Separator } from '@kit/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@kit/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

export function KitDrawerDemo() {
  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant={'outline'} data-test={'kit-open-drawer'} />}
      >
        Ouvrir la fiche d’un prospect (exemple)
      </SheetTrigger>

      <SheetContent className={'gap-0 sm:max-w-[720px]'}>
        <SheetHeader className={'gap-3 p-6 pb-4'}>
          <div className={'flex items-start gap-3'}>
            <div
              className={
                'bg-muted flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium'
              }
            >
              MK
            </div>

            <div className={'flex min-w-0 flex-col gap-1'}>
              <SheetTitle className={'text-lg'}>Momo &amp; Kebab</SheetTitle>

              <SheetDescription>
                Restaurant népalais · Fremont, États-Unis
              </SheetDescription>

              <div className={'mt-1 flex flex-wrap items-center gap-1.5'}>
                <Badge variant={'secondary'} className={badgeExtras.brand}>
                  Contacté
                </Badge>

                <Badge variant={'outline'}>
                  <Star /> 4,4 · 876 avis
                </Badge>
              </div>
            </div>
          </div>

          <div className={'flex flex-wrap gap-2'}>
            <Button size={'sm'} className={buttonExtras.brand}>
              Contacter
            </Button>

            <Button size={'sm'} variant={'outline'}>
              <ExternalLink /> Voir la fiche
            </Button>
          </div>
        </SheetHeader>

        <Separator />

        <Tabs defaultValue={'infos'} className={'min-h-0 flex-1 gap-0'}>
          <TabsList variant={'line'} className={'w-full justify-start px-6'}>
            <TabsTrigger value={'infos'} className={'flex-none px-2'}>
              Coordonnées
            </TabsTrigger>

            <TabsTrigger value={'history'} className={'flex-none px-2'}>
              Historique
            </TabsTrigger>

            <TabsTrigger value={'capture'} className={'flex-none px-2'}>
              Capture
            </TabsTrigger>
          </TabsList>

          <Separator />

          <TabsContent value={'infos'} className={'overflow-y-auto p-6'}>
            <dl
              className={'grid grid-cols-[140px_1fr] gap-x-4 gap-y-3 text-sm'}
            >
              <dt className={'text-muted-foreground'}>Téléphone</dt>
              <dd className={'flex items-center gap-2'}>
                <Phone className={'size-3.5'} /> +1 510-894-4317
              </dd>

              <dt className={'text-muted-foreground'}>Site web</dt>
              <dd className={'flex items-center gap-2'}>
                <Globe className={'size-3.5'} /> momoandkebab.com
              </dd>

              <dt className={'text-muted-foreground'}>Adresse</dt>
              <dd>39175 Farwell Dr, Fremont, CA 94538</dd>

              <dt className={'text-muted-foreground'}>Campagne</dt>
              <dd>NAMMA BOOSTER - Service</dd>

              <dt className={'text-muted-foreground'}>Trouvé le</dt>
              <dd>6 nov. 2026</dd>
            </dl>
          </TabsContent>

          <TabsContent value={'history'} className={'overflow-y-auto p-6'}>
            <p className={'text-muted-foreground text-sm'}>
              Message 2 envoyé le 7 nov. 2026 à 02:21 via le formulaire de
              contact du site.
            </p>
          </TabsContent>

          <TabsContent value={'capture'} className={'overflow-y-auto p-6'}>
            <div
              className={
                'bg-muted text-muted-foreground flex aspect-[4/3] items-center justify-center rounded-xl text-sm'
              }
            >
              Capture du formulaire rempli (en grand)
            </div>
          </TabsContent>
        </Tabs>

        <SheetFooter className={'flex-row justify-between border-t p-4'}>
          <Button variant={'ghost'} size={'sm'}>
            ← Précédent
          </Button>

          <Button variant={'ghost'} size={'sm'}>
            Suivant →
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
