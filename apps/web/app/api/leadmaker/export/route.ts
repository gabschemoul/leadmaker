import { NextResponse } from 'next/server';

import * as z from 'zod';

import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';

import { csvSeparatorFor, toCsvLine } from '~/lib/leadmaker/csv';

const PAGE_SIZE = 1000;

const COLUMNS = [
  'name',
  'category',
  'rating',
  'review_count',
  'address',
  'country_code',
  'phone',
  'website',
  'email',
  'maps_url',
  'source',
  'is_chain',
  'created_at',
] as const;

const QuerySchema = z.union([
  z.object({ space_id: z.string().uuid(), campaign_id: z.undefined() }),
  z.object({ campaign_id: z.string().uuid(), space_id: z.undefined() }),
]);

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
 * Export CSV des prospects d'un espace (?space_id=) ou d'une campagne
 * (?campaign_id=). Client RLS : un membre n'exporte que son organisation.
 * Lecture par pages de 1 000 lignes, écrites au fil de l'eau.
 */
export const GET = enhanceRouteHandler(
  async ({ request, client, user }) => {
    const searchParams = request.nextUrl.searchParams;

    const parsed = QuerySchema.safeParse({
      space_id: searchParams.get('space_id') ?? undefined,
      campaign_id: searchParams.get('campaign_id') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const filter = parsed.data.space_id
      ? { column: 'space_id' as const, id: parsed.data.space_id }
      : { column: 'campaign_id' as const, id: parsed.data.campaign_id! };

    // l'espace ou la campagne doit être visible (RLS) : sinon 404
    const owner =
      filter.column === 'space_id'
        ? await client
            .from('lm_spaces')
            .select('name')
            .eq('id', filter.id)
            .maybeSingle()
        : await client
            .from('lm_campaigns')
            .select('name')
            .eq('id', filter.id)
            .maybeSingle();

    if (owner.error || !owner.data) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const fetchPage = (from: number) =>
      client
        .from('lm_prospects')
        .select(
          'id, name, category, rating, review_count, address, country_code, phone, website, found_email, maps_url, source, is_chain, created_at',
        )
        .eq(filter.column, filter.id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

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
            { name: 'leadmaker.export', userId: user.id, filter, error },
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
                  row.country_code,
                  row.phone,
                  row.website,
                  row.found_email,
                  row.maps_url,
                  row.source,
                  row.is_chain,
                  row.created_at,
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
    const filename = `prospects-${slugify(owner.data.name)}-${date}.csv`;

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
  { auth: true },
);
