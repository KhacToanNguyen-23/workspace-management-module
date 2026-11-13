import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ErrorBox,
  Field,
  SelectField,
  useAction,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";
import { useTr } from "../entry/i18n";

const EMPTY = { name: "", type: "research", description: "", reason: "" };

/**
 * One form for both ways of getting a workspace. Admins and workspace managers create it straight
 * away ("create"); members send a request that an admin approves ("request").
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  mode,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "request";
  /** Called after success; `id` is the new workspace id in "create" mode. */
  onDone: (id?: string) => void;
}) {
  const tr = useTr();
  const api = useApi();
  const act = useAction();
  const types = useQuery<{ code: string; name: string }[]>(
    open ? "/workspace-types" : null,
  );
  const [form, setForm] = useState(EMPTY);
  const isCreate = mode === "create";

  const submit = async () => {
    if (isCreate) {
      const { name, type, description } = form;
      const r = await act.run(() =>
        api<{ id: string }>("POST", "/workspaces", { name, type, description }),
      );
      if (r) {
        setForm(EMPTY);
        onDone(r.id);
      }
    } else {
      const r = await act.run(() =>
        api("POST", "/workspace-requests", form),
      );
      if (r !== undefined) {
        setForm(EMPTY);
        onDone();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base">
              {isCreate ? tr("Tạo workspace") : tr("Xin tạo workspace mới")}
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? tr("Workspace sẽ được tạo ngay cùng quyền quản lý của bạn.")
                : tr("Admin duyệt xong, bạn sẽ trở thành quản lý của workspace đó.")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <Field label={tr("Tên workspace")} htmlFor="cw-name">
              <Input
                id="cw-name"
                required
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label={tr("Loại")} htmlFor="cw-type">
              <SelectField
                id="cw-type"
                size="default"
                className="w-full"
                value={form.type}
                onChange={(type) => setForm({ ...form, type })}
                options={(types.data ?? []).map((t) => ({
                  value: t.code,
                  label: t.name,
                }))}
              />
            </Field>
          </div>
          <Field label={tr("Mô tả")} htmlFor="cw-desc" hint={tr("Tuỳ chọn")}>
            <Textarea
              id="cw-desc"
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>
          {!isCreate && (
            <Field label={tr("Lý do xin tạo")} htmlFor="cw-reason">
              <Textarea
                id="cw-reason"
                rows={2}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </Field>
          )}
          <ErrorBox error={act.error ?? types.error} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {tr("Huỷ")}
            </Button>
            <Button type="submit" size="sm" disabled={act.busy}>
              {isCreate ? tr("Tạo workspace") : tr("Gửi admin duyệt")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
