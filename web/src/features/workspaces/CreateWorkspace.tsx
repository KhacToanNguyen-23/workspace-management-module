import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ErrorBox,
  Field,
  PageBody,
  PageHeader,
  SelectField,
  useAction,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";

export function CreateWorkspacePage() {
  const api = useApi();
  const navigate = useNavigate();
  const act = useAction();
  const types = useQuery<{ code: string; name: string }[]>("/workspace-types");
  const [form, setForm] = useState({
    name: "",
    type: "research",
    description: "",
  });
  return (
    <>
      <PageHeader
        title="Tạo workspace"
        sub="Workspace sẽ được tạo cùng quyền quản lý của bạn."
      />
      <PageBody>
        <form
          className="grid max-w-lg gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act
              .run(() => api<{ id: string }>("POST", "/workspaces", form))
              .then((r) => {
                if (r) navigate(`/w/${r.id}`);
              });
          }}
        >
          <Field label="Tên workspace" htmlFor="cw-name">
            <Input
              id="cw-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Loại" htmlFor="cw-type">
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
          <Field label="Mô tả" htmlFor="cw-desc" hint="Tuỳ chọn">
            <Textarea
              id="cw-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <ErrorBox error={act.error ?? types.error} />
          <div>
            <Button disabled={act.busy}>Tạo workspace</Button>
          </div>
        </form>
      </PageBody>
    </>
  );
}
