import { describe, expect, it } from "vitest";
import { ADMIN, ALICE, BOB, MANAGER, joinAndApprove, seedWorkspace, setup } from "./helpers";

describe("workspaces and approvals", () => {
  it("admin creates a workspace with type defaults and a manager", async () => {
    const { call } = setup();
    const wid = await seedWorkspace(call);
    const list = await call("GET", "/api/admin/workspaces", ADMIN);
    expect(list.data[0]).toMatchObject({ id: wid, type: "research", managers: [MANAGER] });
    expect(list.data[0].permissions).toContain("corpus.fetch");

    const me = await call("GET", "/api/me", MANAGER);
    expect(me.data.memberships[0]).toMatchObject({ role: "manager", status: "approved" });
    expect(me.data.memberships[0].permissions).toContain("members.manage");
  });

  it("non-admins cannot create workspaces", async () => {
    const { call } = setup();
    const res = await call("POST", "/api/admin/workspaces", ALICE, { name: "x", slug: "xx", type: "research" });
    expect(res.status).toBe(403);
  });

  it("a member is locked out until a manager approves the request", async () => {
    const { call } = setup();
    const wid = await seedWorkspace(call);

    expect((await call("GET", `/api/w/${wid}/corpora`, ALICE)).data.error.code).toBe("not_member");

    const join = await call("POST", `/api/workspaces/${wid}/join`, ALICE, { note: "I work on SLR" });
    expect(join.status).toBe(201);
    expect((await call("POST", `/api/workspaces/${wid}/join`, ALICE, {})).status).toBe(409);
    expect((await call("GET", `/api/w/${wid}/corpora`, ALICE)).data.error.code).toBe("pending_approval");

    // Ordinary members cannot see the approval queue.
    expect((await call("GET", `/api/w/${wid}/members`, BOB)).status).toBe(403);

    const pending = await call("GET", `/api/w/${wid}/members?status=pending`, MANAGER);
    expect(pending.data).toHaveLength(1);
    expect(pending.data[0]).toMatchObject({ email: ALICE, note: "I work on SLR", name: "Alice Nguyen" });

    const ok = await call("POST", `/api/w/${wid}/members/${pending.data[0].id}/approve`, MANAGER, { role: "member" });
    expect(ok.status).toBe(200);
    expect((await call("GET", `/api/w/${wid}/corpora`, ALICE)).status).toBe(200);

    const audit = await call("GET", `/api/w/${wid}/audit`, MANAGER);
    expect(audit.data.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(["membership.request", "membership.approve", "workspace.create"]),
    );
  });

  it("rejected users can ask again, and see the decision", async () => {
    const { call } = setup();
    const wid = await seedWorkspace(call);
    await call("POST", `/api/workspaces/${wid}/join`, BOB, {});
    const [req] = (await call("GET", `/api/w/${wid}/members?status=pending`, MANAGER)).data;
    await call("POST", `/api/w/${wid}/members/${req.id}/reject`, MANAGER, { note: "wrong team" });
    const me = await call("GET", "/api/me", BOB);
    expect(me.data.memberships[0]).toMatchObject({ status: "rejected", decisionNote: "wrong team" });
    expect((await call("POST", `/api/workspaces/${wid}/join`, BOB, { note: "again" })).status).toBe(201);
  });

  it("only admins can grant the manager role", async () => {
    const { call } = setup();
    const wid = await seedWorkspace(call);
    await call("POST", `/api/workspaces/${wid}/join`, ALICE, {});
    const [req] = (await call("GET", `/api/w/${wid}/members?status=pending`, MANAGER)).data;
    const res = await call("POST", `/api/w/${wid}/members/${req.id}/approve`, MANAGER, { role: "manager" });
    expect(res.data.error.code).toBe("admin_only");
    expect((await call("POST", `/api/w/${wid}/members/${req.id}/approve`, ADMIN, { role: "manager" })).status).toBe(200);
  });

  it("managers cannot change their own membership", async () => {
    const { call } = setup();
    const wid = await seedWorkspace(call);
    const all = (await call("GET", `/api/w/${wid}/members`, MANAGER)).data;
    const mine = all.find((m: { email: string }) => m.email === MANAGER);
    expect((await call("PATCH", `/api/w/${wid}/members/${mine.id}`, MANAGER, { role: "viewer" })).data.error.code).toBe("self_change");
  });

  it("revoking a member removes access", async () => {
    const { call } = setup();
    const wid = await seedWorkspace(call);
    const mid = await joinAndApprove(call, wid);
    expect((await call("POST", `/api/w/${wid}/members/${mid}/revoke`, MANAGER, { note: "left" })).status).toBe(200);
    expect((await call("GET", `/api/w/${wid}/corpora`, ALICE)).status).toBe(403);
  });

  it("managers can add a directory user directly, but not an unknown address", async () => {
    const { call } = setup();
    const wid = await seedWorkspace(call);
    expect((await call("POST", `/api/w/${wid}/members`, MANAGER, { email: BOB, role: "viewer" })).status).toBe(201);
    expect((await call("GET", `/api/w/${wid}/corpora`, BOB)).status).toBe(200);
    const ghost = await call("POST", `/api/w/${wid}/members`, MANAGER, { email: "ghost@hyperdatalab.org" });
    expect(ghost.data.error.code).toBe("not_in_directory");
    const outsider = await call("POST", `/api/w/${wid}/members`, MANAGER, { email: "x@gmail.com" });
    expect(outsider.data.error.code).toBe("wrong_domain");
  });

  it("workspace permissions cap what each role can do", async () => {
    const { call } = setup();
    const wid = await seedWorkspace(call);
    await joinAndApprove(call, wid);
    let me = await call("GET", `/api/w/${wid}`, ALICE);
    expect(me.data.permissions).toContain("corpus.fetch");

    const put = await call("PUT", `/api/w/${wid}/permissions`, MANAGER, { permissions: ["corpus.read", "corpus.write"] });
    expect(put.status).toBe(200);
    me = await call("GET", `/api/w/${wid}`, ALICE);
    expect(me.data.permissions).toEqual(["corpus.read", "corpus.write"]);

    // The manager keeps members.manage even after switching everything off.
    await call("PUT", `/api/w/${wid}/permissions`, MANAGER, { permissions: [] });
    expect((await call("GET", `/api/w/${wid}`, MANAGER)).data.permissions).toEqual(["members.manage"]);
    expect((await call("PUT", `/api/w/${wid}/permissions`, ALICE, { permissions: ["corpus.read"] })).status).toBe(403);
  });

  it("archived workspaces are closed to members but not to admins", async () => {
    const { call } = setup();
    const wid = await seedWorkspace(call);
    await joinAndApprove(call, wid);
    await call("PATCH", `/api/admin/workspaces/${wid}`, ADMIN, { status: "archived" });
    expect((await call("GET", `/api/w/${wid}/corpora`, ALICE)).data.error.code).toBe("archived");
    expect((await call("GET", `/api/w/${wid}/corpora`, ADMIN)).status).toBe(200);
    expect((await call("GET", "/api/workspaces", ALICE)).data).toEqual([]);
  });
});
