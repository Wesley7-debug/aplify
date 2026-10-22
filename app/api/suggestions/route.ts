import { connection, NextResponse } from "next/server";
import { cityCounts, topCombinations, tradeCounts } from "@/lib/db";
import { labelForTradeKey } from "@/lib/osm/tags";

/**
 * Database-backed typeahead.
 *
 * Suggestions only include combinations that can return results today:
 * a validated email and no published website. When the typed text has no
 * direct match, the top available options are returned instead.
 */

export async function GET(request: Request) {
  await connection();

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") ?? "trade";
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit") ?? "6") || 6, 12));

  try {
    if (kind === "available") {
      const rows = await topCombinations(limit);
      return NextResponse.json({
        suggestions: rows.map((row) => ({
          audience: labelForTradeKey(row.tradeKey),
          location: row.city,
          count: row.total,
          hint: `${row.total} email${row.total === 1 ? "" : "s"} · ${row.city}`,
        })),
      });
    }

    if (kind === "location") {
      const rows = await cityCounts(300);
      const matched = query
        ? rows.filter(
            (row) =>
              row.city.toLowerCase().includes(query) ||
              (row.region ?? "").toLowerCase().includes(query) ||
              (row.country ?? "").toLowerCase().includes(query),
          )
        : rows;
      const picked = (matched.length > 0 ? matched : rows).slice(0, limit);
      return NextResponse.json({
        matched: matched.length > 0 || !query,
        suggestions: picked.map((row) => ({
          value: row.city,
          label: row.country ? `${row.city}, ${row.country}` : row.city,
          hint: `${row.total} email${row.total === 1 ? "" : "s"} available`,
        })),
      });
    }

    const rows = await tradeCounts(300);
    const matched = query
      ? rows.filter((row) => {
          const label = labelForTradeKey(row.tradeKey).toLowerCase();
          return row.tradeKey.includes(query) || label.includes(query);
        })
      : rows;
    const picked = (matched.length > 0 ? matched : rows).slice(0, limit);
    return NextResponse.json({
      matched: matched.length > 0 || !query,
      suggestions: picked.map((row) => ({
        value: labelForTradeKey(row.tradeKey),
        label: labelForTradeKey(row.tradeKey),
        hint: `${row.total} email${row.total === 1 ? "" : "s"} available`,
      })),
    });
  } catch {
    return NextResponse.json({ suggestions: [], matched: false });
  }
}
