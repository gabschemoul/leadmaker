import { NextResponse } from 'next/server';

import * as z from 'zod';

import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';

import { csvSeparatorFor, toCsvLine } from '~/lib/leadmaker/csv';
import {
  applyProspectsFilters,
  parseProspectsSearchParams,
} from '~/lib/leadmaker/prospects-query';

const PAGE_SIZE = 1000;
const MAX_IDS = 2000;

const COLUMNS = [
  'name',
  'category',
  'rating',
  'review_count',
  'address',
  'city',
  'country_code',
  'phone',
  'website',
  'email',
  'maps_url',
  'source',
  'is_chain',
  'created_at',
  'excluded_at',
] as const;

const SELECT =
  'id, name, category, rating, review_count, address, city, country_code, phone, website, found_email, maps_url, source, is_chain, created_at, excluded_at';

const IdsSchema = z
  .string()
  .transform((value) => value.split(',').filter(Boolean))
  .pipe(z.array(z.string().uuid()).min(1).max(MAX_IDS));

const QuerySchema = z.union([
  z.object({
    ids: IdsSchema,
    space_id: z.undefined(),
    campaign_id: z.undefined(),
  }),
  z.object({
    space_id: z.string().uuid(),
    ids: z.undefined(),
    campaign_id: z.undefined(),
  }),
  z.object({
    campaign_id: z.string().uuid(),
    ids: z.undefined(),
    space_id: z.undefined(),
  }),
]);

type Target =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'space'; id: string }
  | { kind: 'campaign'; id: string };

type ExportRow = {
  name: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  address: string | null;
  city: string | null;
  country_code: string | null;
  phone: string | null;
  website: string | null;
  found_email: string | null;
  maps_url: string | null;
  source: string | null;
  is_chain: boolean | null;
  created_at: string | null;
  excluded_at: string | null;
};

function slugify(value: string) {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export'
  );
}

/**
 * Export CSV des prospects :
 * - d'un espace (?space_id=), avec les mêmes filtres que la page Prospects
 *   (q, cat, city, rmin, rmax, reviews, website, source, status, campaign) ;
 * - d'une campagne (?campaign_id=) : campagne triée par l'IA, seulement ses entreprises gardées et payées
 *   (CDC §5.1 « l'export ne sort que des fiches payées », analyse UX T-08) ; ancienne campagne sans phrase
 *   cible, toutes ses fiches ;
 * - d'une sélection (?ids=a,b,c — 2 000 identifiants au plus).
 *
 * Client RLS : un membre n'exporte que son organisation. Lecture par pages de
 * 1 000 lignes, écrites au fil de l'eau.
 */
export const GET = enhanceRouteHandler(
  async ({ request, client, user }) => {
    const searchParams = request.nextUrl.searchParams;

    const parsed = QuerySchema.safeParse({
      ids: searchParams.get('ids') ?? undefined,
      space_id: searchParams.get('space_id') ?? undefined,
      campaign_id: searchParams.get('campaign_id') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const target: Target = parsed.data.ids
      ? { kind: 'ids', ids: parsed.data.ids }
      : parsed.data.space_id
        ? { kind: 'space', id: parsed.data.space_id }
        : { kind: 'campaign', id: parsed.data.campaign_id! };

    let filename: string;
    // campagne triée par l'IA (phrase cible) : on n'exporte que ce que le client a payé
    let sortedCampaign = false;

    if (target.kind === 'ids') {
      filename = 'prospects-selection';
    } else {
      // l'espace ou la campagne doit être visible (RLS) : sinon 404
      const owner =
        target.kind === 'space'
          ? await client
              .from('lm_spaces')
              .select('name, is_default')
              .eq('id', target.id)
              .maybeSingle()
          : await client
              .from('lm_campaigns')
              .select('name, sort_target')
              .eq('id', target.id)
              .maybeSingle();

      if (owner.error || !owner.data) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }

      // l'espace par défaut porte un nom technique (« Default ») : on l'omet
      const isDefaultSpace =
        'is_default' in owner.data && owner.data.is_default === true;

      sortedCampaign =
        'sort_target' in owner.data &&
        (owner.data.sort_target ?? '').trim().length > 0;

      filename = isDefaultSpace
        ? 'prospects'
        : `prospects-${slugify(owner.data.name)}`;
    }

    // les filtres de la page ne s'appliquent qu'à l'export d'un espace
    const filters = parseProspectsSearchParams(
      Object.fromEntries(
        Array.from(new Set(searchParams.keys())).map((key) => [
          key,
          searchParams.getAll(key),
        ]),
      ),
    ).filters;

    const fetchPage = async (
      from: number,
    ): Promise<{ data: ExportRow[] | null; error: unknown }> => {
      if (target.kind === 'campaign' && sortedCampaign) {
        const { data, error } = await client
          .from('lm_campaign_prospects')
          .select(`prospect_id, prospect:lm_prospects!inner(${SELECT})`)
          .eq('campaign_id', target.id)
          // payée = achetée : elle reste exportée même si un nouveau tri (changement de cible) l'a reclassée
          .not('paid_at', 'is', null)
          .or('client_choice.is.null,client_choice.neq.ecartee')
          .order('created_at', { ascending: true })
          .order('prospect_id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        return {
          data: (data ?? []).map((row) => row.prospect as ExportRow),
          error,
        };
      }

      const query = client.from('lm_prospects').select(SELECT);

      const scoped =
        target.kind === 'ids'
          ? query.in('id', target.ids)
          : target.kind === 'space'
            ? applyProspectsFilters(query.eq('space_id', target.id), filters)
            : query.eq('campaign_id', target.id);

      const { data, error } = await scoped
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      return { data: data as ExportRow[] | null, error };
    };

    const separator = csvSeparatorFor(request.headers.get('accept-language'));
    const encoder = new TextEncoder();
    let offset = 0;
    let started = false;

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!started) {
          started = true;
          // BOM UTF-8 : Excel reconnaît alors les accents
          controller.enqueue(
            encoder.encode('﻿' + toCsvLine([...COLUMNS], separator)),
          );
        }

        const { data, error } = await fetchPage(offset);

        if (error) {
          const logger = await getLogger();

          logger.error(
            { name: 'leadmaker.export', userId: user.id, target, error },
            'Prospect export failed',
          );

          controller.error(new Error('export failed'));

          return;
        }

        const rows = data ?? [];

        if (rows.length > 0) {
          const chunk = rows
            .map((row) =>
              toCsvLine(
                [
                  row.name,
                  row.category,
                  row.rating,
                  row.review_count,
                  row.address,
                  row.city,
                  row.country_code,
                  row.phone,
                  row.website,
                  row.found_email,
                  row.maps_url,
                  row.source,
                  row.is_chain,
                  row.created_at,
                  row.excluded_at,
                ],
                separator,
              ),
            )
            .join('');

          controller.enqueue(encoder.encode(chunk));
        }

        offset += rows.length;

        if (rows.length < PAGE_SIZE) {
          controller.close();
        }
      },
    });

    const date = new Date().toISOString().slice(0, 10);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  },
  { auth: true },
);
