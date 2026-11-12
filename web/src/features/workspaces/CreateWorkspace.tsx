import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, ErrorBox, useAction } from "../../shared/components/ui";
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
    <div>
      <PageHeader
        title="Tạo workspace"
        sub="Workspace sẽ được tạo cùng quyền quản lý của bạn."
      />
      <section className="card">
        <ErrorBox error={act.error ?? types.error} />
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act
              .run(() => api<{ id: string }>("POST", "/workspaces", form))
              .then((r) => {
                if (r) navigate(`/w/${r.id}`);
              });
          }}
        >
          <input
            required
            placeholder="Tên workspace"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {(types.data ?? []).map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
          <textarea
            placeholder="Mô tả"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <button className="primary" disabled={act.busy}>
            Tạo workspace
          </button>
        </form>
      </section>
    </div>
  );
}
