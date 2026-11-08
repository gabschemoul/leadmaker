'use client';

import { Fragment } from 'react';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '../shadcn/breadcrumb';
import { If } from './if';
import { Trans } from './trans';

const unslugify = (slug: string) => slug.replace(/-/g, ' ');

// Prospectigo (8/11/2026) : un identifiant technique (UUID) n'a rien à faire
// dans un fil d'Ariane ; sans libellé fourni dans `values`, on le saute.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AppBreadcrumbs(props: {
  values?: Record<string, string>;
  maxDepth?: number;
  /** Nombre de premiers niveaux à ne pas afficher (ex. 2 pour cacher « Accueil › Équipe »). */
  skip?: number;
}) {
  const pathName = usePathname();
  const { locale } = useParams();

  // Remove the locale from the path
  const fullPath = pathName
    .split('/')
    .filter(Boolean)
    .filter((path) => path !== locale);

  const skip = props.skip ?? 0;

  const splitPath = fullPath
    .slice(skip)
    .filter((path) => !UUID.test(path) || path in (props.values ?? {}));

  const values = props.values ?? {};
  const maxDepth = props.maxDepth ?? 6;

  const Ellipsis = (
    <BreadcrumbItem>
      <BreadcrumbEllipsis className="h-4 w-4" />
    </BreadcrumbItem>
  );

  const showEllipsis = splitPath.length > maxDepth;

  const visiblePaths = showEllipsis
    ? ([splitPath[0], ...splitPath.slice(-maxDepth + 1)] as string[])
    : splitPath;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {visiblePaths.map((path, index) => {
          const label =
            path in values ? (
              values[path]
            ) : (
              <Trans
                i18nKey={`common.routes.${unslugify(path)}`}
                defaults={unslugify(path)}
              />
            );

          return (
            <Fragment key={index}>
              <BreadcrumbItem className={'capitalize lg:text-xs'}>
                <If
                  condition={index < visiblePaths.length - 1}
                  fallback={label}
                >
                  <BreadcrumbLink
                    render={
                      <Link
                        href={
                          '/' +
                          fullPath
                            .slice(0, fullPath.indexOf(path) + 1)
                            .join('/')
                        }
                      >
                        {label}
                      </Link>
                    }
                  />
                </If>
              </BreadcrumbItem>

              {index === 0 && showEllipsis && (
                <>
                  <BreadcrumbSeparator />
                  {Ellipsis}
                </>
              )}

              <If condition={index !== visiblePaths.length - 1}>
                <BreadcrumbSeparator />
              </If>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
