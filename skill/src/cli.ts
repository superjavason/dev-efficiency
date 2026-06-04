export interface CliFlags {
  init: boolean;
  days: number | null;
  dryRun: boolean;
  verbose: boolean;
  help: boolean;
}

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    init: false,
    days: null,
    dryRun: false,
    verbose: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--init") flags.init = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--verbose" || a === "-v") flags.verbose = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--days") {
      const next = argv[++i];
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1) throw new Error(`--days requires a positive integer, got ${next}`);
      flags.days = n;
    } else if (a.startsWith("--days=")) {
      const n = Number(a.slice("--days=".length));
      if (!Number.isInteger(n) || n < 1) throw new Error(`--days requires a positive integer, got ${a}`);
      flags.days = n;
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return flags;
}

export const HELP_TEXT = `dev-efficiency-collect — upload local AI token usage to the team server

Usage:
  dev-efficiency-collect              Scan recent days and upload
  dev-efficiency-collect --init       Interactively configure server URL + token
  dev-efficiency-collect --days N     Override backfill window (default: config.backfillDays)
  dev-efficiency-collect --dry-run    Print aggregated records, do not upload
  dev-efficiency-collect --verbose    Print per-file parse progress
  dev-efficiency-collect --help       Show this message

Config: ~/.config/dev-efficiency/config.json (created by --init).
`;
