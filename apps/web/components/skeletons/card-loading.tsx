/**
 * Carte en cours de chargement (10/11/2026, règle « tout le statique s'affiche tout de suite ») : vrai titre et
 * vraie description (clés de traduction), seul le contenu venu de la base est une silhouette.
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

export function CardLoading(props: {
  titleKey?: string;
  descriptionKey?: string;
  /** 'fields' : champs de formulaire ; 'lines' : lignes de texte ; 'area' : grande zone de texte */
  content?: 'fields' | 'lines' | 'area';
  rows?: number;
  children?: React.ReactNode;
}) {
  const rows = props.rows ?? 2;
  const content = props.content ?? 'lines';

  return (
    <Card aria-busy={true}>
      <CardHeader>
        <CardTitle>
          {props.titleKey ? (
            <Trans i18nKey={props.titleKey} />
          ) : (
            <Skeleton className={'h-5 w-48'} />
          )}
        </CardTitle>

        {props.descriptionKey ? (
          <CardDescription>
            <Trans i18nKey={props.descriptionKey} />
          </CardDescription>
        ) : null}
      </CardHeader>

      <CardContent className={'flex flex-col gap-4'}>
        {props.children ??
          (content === 'area' ? (
            <>
              <Skeleton className={'h-32 w-full rounded-md'} />
              <Skeleton className={'h-9 w-32 rounded-full'} />
            </>
          ) : content === 'fields' ? (
            Array.from({ length: rows }).map((_, index) => (
              <div key={index} className={'flex flex-col gap-2'}>
                <Skeleton className={'h-3.5 w-28'} />
                <Skeleton className={'h-9 w-full rounded-md'} />
              </div>
            ))
          ) : (
            Array.from({ length: rows }).map((_, index) => (
              <Skeleton key={index} className={'h-4 w-full'} />
            ))
          ))}
      </CardContent>
    </Card>
  );
}
