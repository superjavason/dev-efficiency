import Link from "next/link";
import { UserAvatar } from "@/components/UserAvatar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./categories";

export interface RankingRow {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  input: number;
  output: number;
  cache: number;
  total: number;
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-sm align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

export function UserRankingTable({ data }: { data: RankingRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>用户</TableHead>
          <TableHead className="text-right">
            <Swatch color={CATEGORY_COLORS.input} /> {CATEGORY_LABELS.input}
          </TableHead>
          <TableHead className="text-right">
            <Swatch color={CATEGORY_COLORS.output} /> {CATEGORY_LABELS.output}
          </TableHead>
          <TableHead className="text-right">
            <Swatch color={CATEGORY_COLORS.cache} /> {CATEGORY_LABELS.cache}
          </TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, idx) => (
          <TableRow key={row.userId}>
            <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
            <TableCell>
              <Link
                href={`/users/${row.userId}`}
                className="group flex items-center gap-2"
              >
                <UserAvatar name={row.name} avatarUrl={row.avatarUrl} size={24} />
                <div className="flex flex-col">
                  <span className="group-hover:underline">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{row.email}</span>
                </div>
              </Link>
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {row.input.toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {row.output.toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {row.cache.toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums font-medium">
              {row.total.toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
        {data.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground">
              所选时段暂无数据
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
