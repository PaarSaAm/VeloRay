import type { HTMLAttributes } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  ChartArea,
  CheckCircle2,
  Clock,
  Code,
  Copy,
  Cpu,
  Database,
  Download,
  FileLock,
  Gauge,
  GitBranch,
  HardDrive,
  Hourglass,
  Info,
  KeyRound,
  Layers,
  Link,
  Lock,
  MemoryStick,
  Network,
  Pause,
  Pencil,
  Play,
  Power,
  RefreshCw,
  Rocket,
  Rss,
  Save,
  Send,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Terminal,
  Trash2,
  TriangleAlert,
  Undo2,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
const icons: Record<string, LucideIcon> = {
  "gauge-high": Gauge,
  "chart-line": Activity,
  "chart-area": ChartArea,
  "diagram-project": Network,
  users: Users,
  server: Server,
  microchip: Cpu,
  "hard-drive": HardDrive,
  memory: MemoryStick,
  "hourglass-half": Hourglass,
  "arrows-rotate": RefreshCw,
  "clock-rotate-left": Clock,
  "shield-halved": Shield,
  "user-shield": UserCog,
  gear: Settings,
  sliders: SlidersHorizontal,
  "paper-plane": Send,
  rss: Rss,
  code: Code,
  key: KeyRound,
  pen: Pencil,
  pause: Pause,
  play: Play,
  "rotate-left": Undo2,
  trash: Trash2,
  bullhorn: Bell,
  clock: Clock,
  "code-branch": GitBranch,
  database: Database,
  lock: Lock,
  "circle-info": Info,
  "circle-check": CheckCircle2,
  copy: Copy,
  download: Download,
  "file-shield": FileLock,
  "layer-group": Layers,
  link: Link,
  terminal: Terminal,
  "triangle-exclamation": TriangleAlert,
  "floppy-disk": Save,
  "power-off": Power,
  rocket: Rocket,
  rotate: RefreshCw,
  "arrow-up-right": ArrowUpRight,
};
type Props = HTMLAttributes<HTMLSpanElement> & {
  icon: string;
  family?: "solid" | "regular" | "brands";
  fixed?: boolean;
};
export function FaIcon({
  icon,
  family: _family,
  fixed = true,
  className,
  ...props
}: Props) {
  const Icon = icons[icon] || Info;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "vr-icon inline-flex shrink-0 items-center justify-center align-middle",
        fixed && "vr-icon-fixed",
        className,
      )}
      {...props}
    >
      <Icon size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
    </span>
  );
}
