import { useRef, useState, type DragEvent } from "react";
import { AlertTriangle, Download, FileArchive, Trash2, Upload, XCircle } from "lucide-react";
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
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
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
        <Button size="sm" variant="secondary" onClick={() => saveSvg(file)} aria-label={`Download ${file.downloadName}`}>
          <Download /> Download
        </Button>
      </div>
      {file.warnings.map((warning) => (
        <p key={warning} className="text-muted-foreground flex gap-2 text-xs">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> {warningText[warning]}
        </p>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <Preview label="Before" src={file.beforeUrl} />
        <Preview label="After" src={file.afterUrl} />
      </div>
    </div>
  );
}

function Preview({ label, src }: { label: string; src: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="text-muted-foreground mb-1 text-xs">{label}</figcaption>
      <div className="rounded-md border bg-white p-2">
        <img src={src} alt={`${label} preview`} className="h-auto w-full" />
      </div>
    </figure>
  );
}
