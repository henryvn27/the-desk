import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyGoogleConnections,
  googleCapabilities,
  updateGoogleConnections,
  type GoogleConnections,
} from "./google-connections";

const at = new Date("2026-09-06T14:00:00.000Z");

function addIdentity(
  state: GoogleConnections,
  id: string,
  kind: "personal" | "school",
  email = `${id}@example.edu`,
) {
  return updateGoogleConnections(
    state,
    {
      type: "identity.add",
      identity: { id, kind, email, label: `${kind} Google` },
    },
    at,
  );
}

test("multiple Google identities remain separate from one another", () => {
  let state = addIdentity(emptyGoogleConnections(), "personal", "personal");
  state = addIdentity(state, "school", "school");
  state = updateGoogleConnections(
    state,
    {
      type: "connection.connect",
      identityId: "personal",
      capabilities: ["calendar.events.read"],
    },
    at,
  );
  assert.equal(state.identities.length, 2);
  assert.equal(state.identities[0]!.phase, "authorization-pending");
  assert.equal(state.identities[1]!.phase, "disconnected");
  assert.equal(
    state.identities[1]!.permissions["calendar.events.read"],
    "not-requested",
  );
  assert.equal("deskAccountId" in state.identities[0]!, false);
});

test("permissions expand one requested capability set at a time", () => {
  let state = addIdentity(emptyGoogleConnections(), "school", "school");
  state = updateGoogleConnections(
    state,
    {
      type: "connection.connect",
      identityId: "school",
      capabilities: ["classroom.coursework.read"],
    },
    at,
  );
  assert.equal(
    state.identities[0]!.permissions["classroom.coursework.read"],
    "authorization-pending",
  );
  assert.equal(
    state.identities[0]!.permissions["drive.files.read"],
    "not-requested",
  );
  state = updateGoogleConnections(
    state,
    {
      type: "authorization.resolve",
      identityId: "school",
      outcomes: [
        { capability: "classroom.coursework.read", result: "authorized" },
      ],
    },
    at,
  );
  assert.equal(state.identities[0]!.phase, "connected");
  state = updateGoogleConnections(
    state,
    {
      type: "connection.connect",
      identityId: "school",
      capabilities: ["drive.files.read"],
    },
    at,
  );
  assert.equal(
    state.identities[0]!.permissions["classroom.coursework.read"],
    "authorized",
  );
  assert.equal(
    state.identities[0]!.permissions["drive.files.read"],
    "authorization-pending",
  );
});

test("admin blocking degrades an identity and keeps an explicit fallback", () => {
  let state = addIdentity(emptyGoogleConnections(), "school", "school");
  state = updateGoogleConnections(
    state,
    {
      type: "connection.connect",
      identityId: "school",
      capabilities: ["calendar.events.read", "classroom.coursework.read"],
    },
    at,
  );
  state = updateGoogleConnections(
    state,
    {
      type: "authorization.resolve",
      identityId: "school",
      outcomes: [
        { capability: "calendar.events.read", result: "authorized" },
        { capability: "classroom.coursework.read", result: "admin-blocked" },
      ],
    },
    at,
  );
  assert.equal(state.identities[0]!.phase, "degraded");
  assert.equal(
    state.identities[0]!.permissions["classroom.coursework.read"],
    "admin-blocked",
  );
  assert.match(
    googleCapabilities().find(({ id }) => id === "classroom.coursework.read")!
      .fallback,
    /Open Classroom normally/,
  );
});

test("permission denial blocks access but can be retried explicitly", () => {
  let state = addIdentity(emptyGoogleConnections(), "school", "school");
  state = updateGoogleConnections(
    state,
    {
      type: "connection.connect",
      identityId: "school",
      capabilities: ["mail.school.read"],
    },
    at,
  );
  state = updateGoogleConnections(
    state,
    {
      type: "authorization.resolve",
      identityId: "school",
      outcomes: [
        { capability: "mail.school.read", result: "permission-denied" },
      ],
    },
    at,
  );
  assert.equal(state.identities[0]!.phase, "blocked");
  assert.throws(
    () =>
      updateGoogleConnections(
        state,
        {
          type: "connection.connect",
          identityId: "school",
          capabilities: ["mail.school.read"],
        },
        at,
      ),
    /must reconnect/,
  );
  state = updateGoogleConnections(
    state,
    {
      type: "connection.reconnect",
      identityId: "school",
      capabilities: ["mail.school.read"],
    },
    at,
  );
  assert.equal(state.identities[0]!.phase, "authorization-pending");
});

test("expired, reconnected, and disconnected states are explicit", () => {
  let state = addIdentity(emptyGoogleConnections(), "school", "school");
  state = updateGoogleConnections(
    state,
    {
      type: "connection.connect",
      identityId: "school",
      capabilities: ["drive.files.read"],
    },
    at,
  );
  state = updateGoogleConnections(
    state,
    {
      type: "authorization.resolve",
      identityId: "school",
      outcomes: [{ capability: "drive.files.read", result: "authorized" }],
    },
    at,
  );
  state = updateGoogleConnections(
    state,
    { type: "connection.expire", identityId: "school" },
    at,
  );
  assert.equal(state.identities[0]!.phase, "reconnect-required");
  state = updateGoogleConnections(
    state,
    {
      type: "connection.reconnect",
      identityId: "school",
      capabilities: ["drive.files.read"],
    },
    at,
  );
  assert.equal(state.identities[0]!.phase, "authorization-pending");
  state = updateGoogleConnections(
    state,
    {
      type: "authorization.resolve",
      identityId: "school",
      outcomes: [{ capability: "drive.files.read", result: "authorized" }],
    },
    at,
  );
  state = updateGoogleConnections(
    state,
    { type: "connection.disconnect", identityId: "school" },
    at,
  );
  assert.equal(state.identities[0]!.phase, "disconnected");
  assert.ok(
    Object.values(state.identities[0]!.permissions).every(
      (permission) => permission === "not-requested",
    ),
  );
});

test("the boundary refuses incomplete or invented authorization results", () => {
  let state = addIdentity(emptyGoogleConnections(), "school", "school");
  state = updateGoogleConnections(
    state,
    {
      type: "connection.connect",
      identityId: "school",
      capabilities: ["calendar.events.read", "drive.files.read"],
    },
    at,
  );
  assert.throws(
    () =>
      updateGoogleConnections(
        state,
        {
          type: "authorization.resolve",
          identityId: "school",
          outcomes: [
            { capability: "calendar.events.read", result: "authorized" },
          ],
        },
        at,
      ),
    /resolve every pending capability/,
  );
  assert.equal(
    state.identities[0]!.implementation.authorization,
    "adapter-required",
  );
  assert.equal(state.identities[0]!.implementation.sync, "not-implemented");
  assert.equal(JSON.stringify(state).includes("synced"), false);
});

test("duplicate identities and duplicate permission requests fail closed", () => {
  const state = addIdentity(emptyGoogleConnections(), "school", "school");
  assert.throws(() => addIdentity(state, "school", "school"), /already exists/);
  assert.throws(
    () =>
      updateGoogleConnections(
        state,
        {
          type: "connection.connect",
          identityId: "school",
          capabilities: ["drive.files.read", "drive.files.read"],
        },
        at,
      ),
    /unique/,
  );
  assert.throws(
    () =>
      updateGoogleConnections(
        state,
        {
          type: "connection.connect",
          identityId: "school",
          capabilities: [
            "calendar.events.read",
            "mail.school.read",
            "classroom.coursework.read",
            "drive.files.read",
          ],
        },
        at,
      ),
    /progressively/,
  );
});
