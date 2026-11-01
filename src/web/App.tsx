import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { AlertTriangle, ArrowLeftRight, ChevronsLeftRight, Download, FileArchive, Moon, Sun, Trash2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBytes, warningText } from "../core/format";
import { processFile, releaseEntry, saveAll, saveSvg, saveZip, type FileEntry, type OptimizedFile } from "./lib/files";

export function App() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const processed = await Promise.all(Array.from(files).map(processFile));
    setEntries((current) => [...current, ...processed]);
  };

  const clear = () => {
    entries.forEach(releaseEntry);
    setEntries([]);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  };

  const optimized = entries.filter((e): e is OptimizedFile => e.status === "ok");

  return (
    <main className="flex w-full flex-col gap-6 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Claude SVG Optimizer</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Removes redundant styles and metadata from SVG files downloaded from claude.ai. Your files stay in this
          browser.
        </p>
      </header>

      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors",
          "hover:bg-accent focus-within:ring-ring focus-within:ring-2",
          dragging && "border-primary bg-accent",
        )}
      >
        <Upload className="text-muted-foreground size-8" aria-hidden />
        <span className="font-medium">Drop SVG files here, or click to choose files</span>
        <input
          ref={inputRef}
          type="file"
          accept=".svg,image/svg+xml"
          multiple
          className="sr-only"
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>

      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {optimized.length >= 2 && (
            <>
              <Button onClick={() => void saveAll(optimized)}>
                <Download /> Download all
              </Button>
              <Button variant="secondary" onClick={() => saveZip(optimized)}>
                <FileArchive /> Download as ZIP
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={clear}>
            <Trash2 /> Clear
          </Button>
          {optimized.length >= 2 && (
            <p className="text-muted-foreground w-full text-xs">
              Your browser can ask for permission to download many files.
            </p>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-4">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Card className="py-4">
              <CardContent className="px-4">
                {entry.status === "ok" ? <ResultRow file={entry} /> : <ErrorRow name={entry.name} message={entry.message} />}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}

function ErrorRow({ name, message }: { name: string; message: string }) {
  return (
    <div role="alert" className="flex gap-2">
      <XCircle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        <p className="text-muted-foreground text-sm break-words">This file is not a valid SVG. {message}</p>
      </div>
    </div>
  );
}

function ResultRow({ file }: { file: OptimizedFile }) {
  const [background, setBackground] = useState(file.background);
  const [mode, setMode] = useState<"slider" | "whole">("slider");
  const [shown, setShown] = useState<"Before" | "After">("After");
  const dark = background === "dark";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{file.name}</p>
          <p className="text-muted-foreground text-sm">
            {formatBytes(file.originalBytes)} → {formatBytes(file.optimizedBytes)}{" "}
            <strong className="text-foreground font-semibold">−{file.reducedPercent.toFixed(1)}%</strong>
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setBackground(dark ? "light" : "dark")}>
            {dark ? <Sun /> : <Moon />} {dark ? "Light preview" : "Dark preview"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => saveSvg(file)} aria-label={`Download ${file.downloadName}`}>
            <Download /> Download
          </Button>
        </div>
      </div>
      {file.warnings.map((warning) => (
        <p key={warning} className="text-muted-foreground flex gap-2 text-xs">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> {warningText[warning]}
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <ChoiceGroup label="Preview mode" value={mode} options={[["slider", "Slider"], ["whole", "Whole image"]]} onChange={setMode} />
        {mode === "whole" && (
          <Button size="sm" variant="secondary" className="w-36" onClick={() => setShown(shown === "Before" ? "After" : "Before")}>
            <ArrowLeftRight /> Show {shown === "Before" ? "After" : "Before"}
          </Button>
        )}
      </div>
      <Stage file={file} dark={dark} mode={mode} shown={shown} />
    </div>
  );
}

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-lg border p-0.5">
      {options.map(([option, text]) => (
        <Button
          key={option}
          size="sm"
          variant={option === value ? "secondary" : "ghost"}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {text}
        </Button>
      ))}
    </div>
  );
}

const imageClass = "absolute inset-0 size-full";
const tagClass = "pointer-events-none absolute top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white";

function Stage({
  file,
  dark,
  mode,
  shown,
}: {
  file: OptimizedFile;
  dark: boolean;
  mode: "slider" | "whole";
  shown: "Before" | "After";
}) {
  const [ratio, setRatio] = useState(4 / 3);
  const [position, setPosition] = useState(50);

  const moveTo = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setPosition(Math.round(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100))));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowLeft: -2, ArrowDown: -2, ArrowRight: 2, ArrowUp: 2 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    setPosition((current) => Math.min(100, Math.max(0, current + step)));
  };

  const onLoad = (event: { currentTarget: HTMLImageElement }) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth && naturalHeight) setRatio(naturalWidth / naturalHeight);
  };

  const sliderProps =
    mode === "slider"
      ? {
          role: "slider",
          tabIndex: 0,
          "aria-label": "Compare before and after",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": position,
          onKeyDown,
          onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            moveTo(event);
          },
          onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event);
          },
        }
      : {};

  return (
    <div
      data-testid="preview"
      {...sliderProps}
      style={{ aspectRatio: ratio, width: `min(100%, calc((100dvh - 2rem) * ${ratio}))` }}
      className={cn(
        "relative mx-auto overflow-hidden rounded-md border select-none",
        dark ? "bg-[#262624]" : "bg-white",
        mode === "slider" && "focus-visible:ring-ring cursor-ew-resize touch-none outline-none focus-visible:ring-2",
      )}
    >
      {mode === "slider" ? (
        <>
          {/* Each image is cut at the line. These files have no background, so text in an image below would show through. */}
          <img
            src={file.afterUrl}
            alt="After preview"
            draggable={false}
            onLoad={onLoad}
            className={imageClass}
            style={{ clipPath: `inset(0 0 0 ${position}%)` }}
          />
          <img
            src={file.beforeUrl}
            alt="Before preview"
            draggable={false}
            className={imageClass}
            style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{ left: `${position}%` }}
          >
            <ChevronsLeftRight className="absolute top-1/2 left-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white p-1 text-black shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" aria-hidden />
          </div>
          <span className={cn(tagClass, "left-2")}>Before</span>
          <span className={cn(tagClass, "right-2")}>After</span>
        </>
      ) : (
        <>
          <img
            src={shown === "Before" ? file.beforeUrl : file.afterUrl}
            alt={`${shown} preview`}
            onLoad={onLoad}
            className={imageClass}
          />
          <span className={cn(tagClass, "left-2")}>{shown}</span>
        </>
      )}
    </div>
  );
}
