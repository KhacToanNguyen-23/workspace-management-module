import { describe, expect, it } from "vitest";
import { ADMIN, ALICE, setup } from "./helpers";

describe("sign-in and directory", () => {
  it("rejects requests without a token", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/me", null)).status).toBe(401);
  });

  it("rejects accounts outside @hyperdatalab.org", async () => {
    const { call } = setup();
    const res = await call("GET", "/api/me", "eve@gmail.com");
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe("wrong_domain");
  });

  it("rejects domain addresses that are not in the directory", async () => {
    const { call } = setup();
    const res = await call("GET", "/api/me", "ghost@hyperdatalab.org");
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe("not_in_directory");
  });

  it("rejects suspended directory users", async () => {
    const { call } = setup();
    const res = await call("GET", "/api/me", "gone@hyperdatalab.org");
    expect(res.data.error.code).toBe("suspended");
  });

  it("creates the user from directory data on first sign-in", async () => {
    const { call } = setup();
    const res = await call("GET", "/api/me", ALICE);
    expect(res.status).toBe(200);
    expect(res.data.user).toMatchObject({ email: ALICE, name: "Alice Nguyen", orgUnit: "/research", isAdmin: false });
    expect(res.data.memberships).toEqual([]);
  });

  it("makes admin@hyperdatalab.org a global admin automatically", async () => {
    const { call } = setup();
    const res = await call("GET", "/api/me", ADMIN);
    expect(res.data.user.isAdmin).toBe(true);
    expect((await call("GET", "/api/admin/users", ALICE)).status).toBe(403);
  });

  it("lets the admin sync the directory and disable a user", async () => {
    const { call } = setup();
    const sync = await call("POST", "/api/admin/users/sync", ADMIN);
    expect(sync.data).toMatchObject({ listed: 5, mode: "mock" });
    const users = await call("GET", "/api/admin/users", ADMIN);
    expect(users.data.map((u: { email: string }) => u.email)).toContain("bob@hyperdatalab.org");

    expect((await call("PATCH", `/api/admin/users/${encodeURIComponent(ALICE)}`, ADMIN, { disabled: true })).status).toBe(200);
    const blocked = await call("GET", "/api/me", ALICE);
    expect(blocked.data.error.code).toBe("disabled");
  });

  it("protects the domain admin account", async () => {
    const { call } = setup();
    await call("GET", "/api/me", ADMIN);
    const res = await call("PATCH", `/api/admin/users/${encodeURIComponent(ADMIN)}`, ADMIN, { disabled: true });
    expect(res.status).toBe(409);
  });
});
