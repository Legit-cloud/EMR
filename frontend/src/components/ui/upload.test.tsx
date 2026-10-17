import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { checkFiles, Dropzone, fileKind, FileRow, formatBytes } from "./upload";

function file(name: string, bytes: number, type = "application/pdf") {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("upload helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("knows documents, images and PDFs", () => {
    expect(fileKind("scan.pdf")).toBe("pdf");
    expect(fileKind("x", "application/pdf")).toBe("pdf");
    expect(fileKind("xray.jpg")).toBe("image");
    expect(fileKind("referral.docx")).toBe("doc");
  });

  it("rejects files over the size limit and beyond the file count", () => {
    const { accepted, rejected } = checkFiles(
      [file("a.pdf", 10), file("big.pdf", 2000), file("b.pdf", 10), file("c.pdf", 10)],
      1000,
      2,
    );
    expect(accepted.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(rejected).toEqual([
      "big.pdf is larger than 1000 B.",
      "c.pdf was not added: file limit reached.",
    ]);
  });
});

describe("Dropzone", () => {
  it("passes chosen files on and shows the limits", async () => {
    const onFiles = vi.fn();
    render(<Dropzone label="Attachments" onFiles={onFiles} count={1} />);
    expect(screen.getByText(/Maximum upload file size: 10 MB/)).toBeInTheDocument();
    expect(screen.getByText("1 of 5")).toBeInTheDocument();
    const input = screen.getByLabelText("Attachments");
    await userEvent.upload(input, file("lab.pdf", 100));
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: "lab.pdf" })]);
  });

  it("explains why a file was refused", async () => {
    const onFiles = vi.fn();
    render(<Dropzone label="Attachments" onFiles={onFiles} count={0} maxBytes={50} />);
    await userEvent.upload(screen.getByLabelText("Attachments"), file("huge.pdf", 100));
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("huge.pdf is larger than 50 B.");
  });

  it("disables browsing once full", () => {
    render(<Dropzone label="Attachments" onFiles={vi.fn()} count={5} />);
    expect(screen.getByLabelText("Attachments")).toBeDisabled();
  });
});

describe("FileRow", () => {
  it("shows progress while uploading and can be removed", async () => {
    const onRemove = vi.fn();
    render(
      <FileRow name="xray.png" size={2048} type="image/png" progress={42} onRemove={onRemove} />,
    );
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Upload of xray.png" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove xray.png" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("shows a stored file as complete", () => {
    render(<FileRow name="report.pdf" size={1024} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
