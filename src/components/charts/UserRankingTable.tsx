import { UserAvatar } from "@/components/UserAvatar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export interface RankingRow {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  total: number;
}

export function UserRankingTable({ data }: { data: RankingRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>用户</TableHead>
          <TableHead className="text-right">Token 总量</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, idx) => (
          <TableRow key={row.userId}>
            <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <UserAvatar name={row.name} avatarUrl={row.avatarUrl} size={24} />
                <div className="flex flex-col">
                  <span>{row.name}</span>
                  <span className="text-xs text-muted-foreground">{row.email}</span>
                </div>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{row.total.toLocaleString()}</TableCell>
          </TableRow>
        ))}
        {data.length === 0 && (
          <TableRow>
            <TableCell colSpan={3} className="text-center text-muted-foreground">
              所选时段暂无数据
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
