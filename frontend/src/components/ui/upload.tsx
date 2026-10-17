"use client";

import { CloudArrowUp, FileText, FilePdf, ImageSquare, Trash } from "@phosphor-icons/react";
import { type DragEvent, useId, useRef, useState } from "react";

import { cx } from "@/lib/cx";
import type { Tone } from "@/lib/status-map";

import { IconButton } from "./button";
import { FOCUS_WITHIN_RING } from "./focus";
import { IconTile } from "./icon-tile";
import { ProgressBar } from "./progress";

const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1).replace(/\.0$/, "")} MB`;
}

type Accepted = { accepted: File[]; rejected: string[] };

/** Splits dropped files into those that fit the size and count limits and reasons for the rest. */
export function checkFiles(files: File[], maxBytes: number, slotsLeft: number): Accepted {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    if (file.size > maxBytes)
      rejected.push(`${file.name} is larger than ${formatBytes(maxBytes)}.`);
    else if (accepted.length >= slotsLeft)
      rejected.push(`${file.name} was not added: file limit reached.`);
    else accepted.push(file);
  }
  return { accepted, rejected };
}

type DropzoneProps = {
  label: string;
  onFiles: (files: File[]) => void;
  /** Files already attached, for the "1 of 5" count. */
  count: number;
  maxFiles?: number;
  maxBytes?: number;
  /** Passed to the file input, for example "image/*,application/pdf". */
  accept?: string;
};

/** Dashed drop area with a Browse link (docs/DESIGN.md Section 7). */
export function Dropzone({
  label,
  onFiles,
  count,
  maxFiles = 5,
  maxBytes = 10 * MB,
  accept,
}: DropzoneProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const full = count >= maxFiles;

  function take(list: FileList | null) {
    const { accepted, rejected } = checkFiles(Array.from(list ?? []), maxBytes, maxFiles - count);
    setErrors(rejected);
    if (accepted.length) onFiles(accepted);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!full) take(event.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-small text-ink-600 font-semibold">
        {label}
      </span>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "rounded-control flex flex-col items-center gap-2 border border-dashed px-4 py-6 text-center transition-colors duration-150 ease-out",
          dragging ? "border-blue-600 bg-blue-50" : "bg-surface border-blue-600/40",
          full && "opacity-60",
        )}
      >
        <CloudArrowUp aria-hidden size={28} className="text-blue-600" />
        <p className="text-body text-ink-900">
          Drag and drop files here <span className="text-ink-300">|</span>{" "}
          <label
            className={cx("rounded-tag inline-block", !full && "cursor-pointer", FOCUS_WITHIN_RING)}
          >
            <span className={full ? "text-ink-400" : "font-semibold text-blue-600 hover:underline"}>
              Browse Files
            </span>
            <input
              ref={input}
              type="file"
              multiple={maxFiles - count > 1}
              accept={accept}
              disabled={full}
              aria-labelledby={`${id}-label`}
              aria-describedby={`${id}-help`}
              onChange={(event) => {
                take(event.target.files);
                event.target.value = "";
              }}
              className="sr-only"
            />
          </label>
        </p>
        <p id={`${id}-help`} className="text-small text-ink-500">
          Maximum upload file size: {formatBytes(maxBytes)} ·{" "}
          <span className="tnum">
            {count} of {maxFiles}
          </span>
        </p>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="text-small text-pink-text flex flex-col gap-0.5">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

type FileKind = "doc" | "image" | "pdf";

export function fileKind(name: string, type = ""): FileKind {
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|dcm)$/i.test(name)) return "image";
  return "doc";
}

const KIND: Record<FileKind, { tone: Tone; icon: typeof FileText }> = {
  doc: { tone: "blue", icon: FileText },
  image: { tone: "teal", icon: ImageSquare },
  pdf: { tone: "pink", icon: FilePdf },
};

type FileRowProps = {
  name: string;
  size: number;
  type?: string;
  /** 0 to 100 while uploading; leave out once stored. */
  progress?: number;
  onRemove?: () => void;
};

/** Uploaded or uploading file: type tile, name, size, percent and a thin progress bar. */
export function FileRow({ name, size, type, progress, onRemove }: FileRowProps) {
  const kind = KIND[fileKind(name, type)];
  const percent = progress === undefined ? 100 : Math.round(progress);
  return (
    <div className="border-line bg-surface rounded-control flex items-center gap-3 border p-3">
      <IconTile icon={kind.icon} tone={kind.tone} size={36} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-body text-ink-900 truncate font-semibold">{name}</span>
          <span className="text-small text-ink-600 tnum shrink-0">{percent}%</span>
        </div>
        <span className="text-small text-ink-500">{formatBytes(size)}</span>
        <ProgressBar label={`Upload of ${name}`} value={percent} max={100} showFraction={false} />
      </div>
      {onRemove && <IconButton icon={Trash} label={`Remove ${name}`} onClick={onRemove} />}
    </div>
  );
}
