"use client";

import { Plus } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import {
  codeFrom,
  type Department,
  type Facility,
  refusalMessage,
  useDepartments,
  useFacilities,
  useSaveDepartment,
  useSaveFacility,
} from "@/lib/organisation";
import { useMe } from "@/lib/session";

type Editing =
  | { kind: "facility"; item: Facility | null }
  | { kind: "department"; item: Department | null }
  | null;

/** The sites of the organisation and the departments in each. The administrator maintains them. */
export function OrganisationScreen() {
  const me = useMe();
  const facilities = useFacilities();
  const departments = useDepartments();
  const [editing, setEditing] = useState<Editing>(null);
  const isAdmin = me.roles.includes("tenant_admin");

  if (
    facilities.error instanceof ApiRequestError &&
    (facilities.error.status === 403 || facilities.error.status === 401)
  ) {
    return <NoAccess what="facilities and departments" asPage />;
  }

  const byFacility = (id: string) => (departments.data ?? []).filter((d) => d.facility === id);

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Facilities and departments</h1>
        {isAdmin && (
          <Button
            icon={Plus}
            className="ml-auto"
            onClick={() => setEditing({ kind: "facility", item: null })}
          >
            Add a facility
          </Button>
        )}
      </header>
      <p className="text-body text-ink-600">
        Each site, and the departments and units inside it. Staff and wards belong to these.
      </p>
      {facilities.isError && (
        <Banner tone="danger" title="Facilities could not be loaded.">
          <Button variant="outline" onClick={() => facilities.refetch()}>
            Try again
          </Button>
        </Banner>
      )}
      {facilities.data?.length === 0 && <EmptyState title="No facilities have been added yet." />}
      <div className="flex flex-col gap-5">
        {(facilities.data ?? []).map((facility) => (
          <Card
            key={facility.id}
            title={facility.name}
            action={
              isAdmin ? (
                <span className="flex gap-2">
                  <Button
                    variant="ghost"
                    aria-label={`Rename ${facility.name}`}
                    onClick={() => setEditing({ kind: "facility", item: facility })}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={`Add a department to ${facility.name}`}
                    onClick={() =>
                      setEditing({
                        kind: "department",
                        item: { id: "", facility: facility.id, name: "" },
                      })
                    }
                  >
                    Add a department
                  </Button>
                </span>
              ) : undefined
            }
          >
            {byFacility(facility.id).length === 0 ? (
              <p className="text-small text-ink-600">No departments yet.</p>
            ) : (
              <ul aria-label={`Departments of ${facility.name}`} className="flex flex-col">
                {byFacility(facility.id).map((department) => (
                  <li
                    key={department.id}
                    className="border-line text-body flex items-center gap-3 border-t py-2.5 first:border-t-0"
                  >
                    <span className="text-ink-900 flex-1">{department.name}</span>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        aria-label={`Rename ${department.name}`}
                        onClick={() => setEditing({ kind: "department", item: department })}
                      >
                        Rename
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
      <FacilityDialog
        key={editing?.kind === "facility" ? (editing.item?.id ?? "new") : "none"}
        item={editing?.kind === "facility" ? editing.item : undefined}
        onClose={() => setEditing(null)}
      />
      <DepartmentDialog
        key={
          editing?.kind === "department"
            ? `d-${editing.item?.id}-${editing.item?.facility}`
            : "none"
        }
        item={editing?.kind === "department" ? editing.item : undefined}
        facilities={facilities.data ?? []}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function FacilityDialog({
  item,
  onClose,
}: {
  /** undefined: closed; null: a new facility. */
  item: Facility | null | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSaveFacility(item?.id);
  const [name, setName] = useState(item?.name ?? "");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setProblem(null);
    if (!name.trim()) return;
    try {
      await save.mutateAsync({ name: name.trim(), code: item?.code ?? codeFrom(name) });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: item ? "Saved" : "Facility added", description: name.trim(), tone: "success" });
    onClose();
  }

  return (
    <Modal
      open={item !== undefined}
      onOpenChange={(open) => !open && onClose()}
      title={item ? "Rename the facility" : "Add a facility"}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="edit-facility" loading={save.isPending}>
              Save
            </Button>
          }
        />
      }
    >
      <form id="edit-facility" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Input
          label="Name"
          value={name}
          maxLength={200}
          error={tried && !name.trim() ? "Enter the name." : undefined}
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function DepartmentDialog({
  item,
  facilities,
  onClose,
}: {
  /** undefined: closed; an item with no id: a new department. */
  item: Department | null | undefined;
  facilities: Facility[];
  onClose: () => void;
}) {
  const toast = useToast();
  const existing = item?.id ? item : null;
  const save = useSaveDepartment(existing?.id);
  const [name, setName] = useState(item?.name ?? "");
  const [facility, setFacility] = useState(item?.facility ?? "");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setProblem(null);
    if (!name.trim() || !facility) return;
    try {
      await save.mutateAsync({ name: name.trim(), facility });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({
      title: existing ? "Saved" : "Department added",
      description: name.trim(),
      tone: "success",
    });
    onClose();
  }

  return (
    <Modal
      open={item !== undefined && item !== null}
      onOpenChange={(open) => !open && onClose()}
      title={existing ? "Rename the department" : "Add a department"}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="edit-department" loading={save.isPending}>
              Save
            </Button>
          }
        />
      }
    >
      <form id="edit-department" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Select
          label="Facility"
          value={facility}
          onValueChange={setFacility}
          options={facilities.map((f) => ({ value: f.id, label: f.name }))}
          disabled={existing !== null}
        />
        <Input
          label="Name"
          value={name}
          maxLength={200}
          error={tried && !name.trim() ? "Enter the name." : undefined}
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Modal>
  );
}
